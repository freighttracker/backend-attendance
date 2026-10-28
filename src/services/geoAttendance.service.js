const moment = require('moment-timezone');
const AttendanceGeoPolicy = require('../models/AttendanceGeoPolicy');
const EmployeeOfficeAssignment = require('../models/EmployeeOfficeAssignment');
const AttendanceRecord = require('../models/AttendanceRecord');
const { logger } = require('../utils/logger');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

// Used when neither the company nor the platform has saved a policy yet -
// both modes 'off' keeps check-in/out exactly as it was before geofencing.
const DEFAULT_POLICY = Object.freeze({
    company: null,
    checkInMode: 'off',
    checkOutMode: 'off',
    defaultRadiusMeters: 100,
    maxAccuracyMeters: 100,
    allowExceptions: true,
    locationRetentionDays: 365
});

const EARTH_RADIUS_METERS = 6371008.8;
const MAX_REPORTED_ACCURACY_METERS = 100000;
const EXCEPTION_REASON_MIN = 5;
const EXCEPTION_REASON_MAX = 500;

const toRadians = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in metres (haversine). Accurate to well under a
// metre at geofence scales, which is far below GPS noise.
const distanceMeters = (lat1, lon1, lat2, lon2) => {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
};

const toFiniteNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return NaN;
};

const isBlank = (value) => value === undefined || value === null || value === '';

// Parses the device-reported reading. Returns { coords: null } when the
// client sent no location at all, { error } when it sent something unusable.
const parseCoordinates = ({ latitude, longitude, accuracy } = {}) => {
    if (isBlank(latitude) && isBlank(longitude) && isBlank(accuracy)) {
        return { coords: null, error: null };
    }

    const lat = toFiniteNumber(latitude);
    const lon = toFiniteNumber(longitude);
    const acc = toFiniteNumber(accuracy);

    if (Number.isNaN(lat) || lat < -90 || lat > 90) return { coords: null, error: 'Latitude must be a number between -90 and 90' };
    if (Number.isNaN(lon) || lon < -180 || lon > 180) return { coords: null, error: 'Longitude must be a number between -180 and 180' };
    // 0,0 is what a broken/defaulted location provider reports, not a real office.
    if (lat === 0 && lon === 0) return { coords: null, error: 'Location 0,0 is not a valid reading' };
    if (Number.isNaN(acc) || acc <= 0 || acc > MAX_REPORTED_ACCURACY_METERS) {
        return { coords: null, error: 'GPS accuracy (in metres) is required with the location' };
    }

    return {
        coords: {
            latitude: Number(lat.toFixed(7)),
            longitude: Number(lon.toFixed(7)),
            accuracy: Math.round(acc * 10) / 10
        },
        error: null
    };
};

const policyToPlain = (doc) => ({
    ...DEFAULT_POLICY,
    ...(doc ? (doc.toObject ? doc.toObject() : doc) : {})
});

// Company policy -> platform default (company: null) -> built-in defaults.
const getEffectivePolicy = async (companyId) => {
    if (companyId) {
        const own = await AttendanceGeoPolicy.findOne({ company: companyId }).lean();
        if (own) return { ...policyToPlain(own), source: 'company' };
    }
    const platform = await AttendanceGeoPolicy.findOne({ company: null }).lean();
    if (platform) return { ...policyToPlain(platform), company: companyId || null, source: 'platform' };
    return { ...DEFAULT_POLICY, company: companyId || null, source: 'default' };
};

const activeAssignmentFilter = (userId, at = new Date()) => ({
    user: userId,
    isActive: true,
    $and: [
        { $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: at } }] },
        { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: at } }] }
    ]
});

// Offices the employee may use right now: active assignment, inside its
// effective window, and the office itself still active.
const getActiveOfficesForUser = async (userId, at = new Date()) => {
    const assignments = await EmployeeOfficeAssignment.find(activeAssignmentFilter(userId, at))
        .populate('office')
        .lean();

    return assignments
        .filter((a) => a.office && a.office.isActive)
        .map((a) => ({ ...a.office, isPrimary: !!a.isPrimary, assignmentId: a._id }));
};

const ACTION_LABEL = { checkIn: 'check in', checkOut: 'check out' };

// Decides whether a check-in/check-out may proceed and builds the location
// metadata to store with it. Never trusts a client-supplied office: the
// office is always the nearest permitted one computed here.
const evaluatePunch = async ({ user, action, body = {}, now = new Date() }) => {
    const policy = await getEffectivePolicy(user.company);
    const mode = action === 'checkIn' ? policy.checkInMode : policy.checkOutMode;
    const actionLabel = ACTION_LABEL[action];

    const parsed = parseCoordinates(body);
    const rawReason = typeof body.exceptionReason === 'string' ? body.exceptionReason.trim() : '';

    if (mode !== 'off' && parsed.error) {
        return { ok: false, httpStatus: 400, code: 'INVALID_COORDINATES', message: parsed.error };
    }
    if (rawReason && (rawReason.length < EXCEPTION_REASON_MIN || rawReason.length > EXCEPTION_REASON_MAX)) {
        return {
            ok: false,
            httpStatus: 400,
            code: 'INVALID_EXCEPTION_REASON',
            message: `Exception reason must be between ${EXCEPTION_REASON_MIN} and ${EXCEPTION_REASON_MAX} characters`
        };
    }

    const coords = parsed.error ? null : parsed.coords;
    const allOffices = await getActiveOfficesForUser(user._id || user.id, now);
    const offices = allOffices.filter((o) => (action === 'checkIn' ? o.allowCheckIn !== false : o.allowCheckOut !== false));

    const meta = {
        latitude: coords ? coords.latitude : undefined,
        longitude: coords ? coords.longitude : undefined,
        accuracy: coords ? coords.accuracy : undefined,
        policyMode: mode
    };

    let nearest = null;
    let inside = [];
    if (coords && offices.length) {
        const measured = offices
            .map((office) => ({
                office,
                distance: distanceMeters(coords.latitude, coords.longitude, office.latitude, office.longitude)
            }))
            .sort((a, b) => a.distance - b.distance);
        inside = measured.filter((m) => m.distance <= m.office.radiusMeters);
        nearest = inside[0] || measured[0];
        meta.office = nearest.office._id;
        meta.officeName = nearest.office.name;
        meta.distanceMeters = Math.round(nearest.distance);
    }

    if (mode === 'off') {
        return { ok: true, meta: { ...meta, validationStatus: 'not_required', reviewStatus: 'none' }, policy };
    }

    let failure = null;
    if (!coords) {
        failure = {
            httpStatus: 400,
            code: 'LOCATION_REQUIRED',
            validationStatus: 'no_location',
            message: `Your location is required to ${actionLabel}. Allow location access and try again.`
        };
    } else if (!offices.length) {
        failure = {
            httpStatus: 403,
            code: 'NO_ACTIVE_OFFICE',
            validationStatus: 'no_office',
            message: allOffices.length
                ? `None of your assigned offices accepts ${actionLabel}. Contact HR.`
                : 'You have no active office assigned for attendance. Contact HR.'
        };
    } else {
        const maxAccuracy = nearest.office.maxAccuracyMeters || policy.maxAccuracyMeters;
        if (coords.accuracy > maxAccuracy) {
            failure = {
                httpStatus: 422,
                code: 'LOW_ACCURACY',
                validationStatus: 'low_accuracy',
                message: `Your location is only accurate to ±${Math.round(coords.accuracy)} m; ±${maxAccuracy} m or better is required. Turn on precise location, move near a window or outdoors, and retry.`,
                details: { accuracy: coords.accuracy, maxAccuracyMeters: maxAccuracy }
            };
        } else if (!inside.length) {
            failure = {
                httpStatus: 403,
                code: 'OUTSIDE_GEOFENCE',
                validationStatus: 'outside_geofence',
                message: `You are ${meta.distanceMeters} m from ${nearest.office.name}; you must be within ${nearest.office.radiusMeters} m to ${actionLabel}.`,
                details: { distanceMeters: meta.distanceMeters, radiusMeters: nearest.office.radiusMeters, officeName: nearest.office.name }
            };
        }
    }

    if (!failure) {
        return { ok: true, meta: { ...meta, validationStatus: 'valid', reviewStatus: 'none' }, policy };
    }

    meta.validationStatus = failure.validationStatus;

    if (mode === 'flag') {
        return {
            ok: true,
            meta: { ...meta, reviewStatus: 'pending', exceptionReason: rawReason || undefined },
            warning: `${failure.message} It was recorded and flagged for admin review.`,
            policy
        };
    }

    if (policy.allowExceptions && rawReason) {
        return {
            ok: true,
            meta: { ...meta, reviewStatus: 'pending', exceptionReason: rawReason },
            warning: 'Recorded as a location exception pending admin review.',
            policy
        };
    }

    return {
        ok: false,
        httpStatus: failure.httpStatus,
        code: failure.code,
        message: failure.message,
        details: { ...(failure.details || {}), canRequestException: !!policy.allowExceptions }
    };
};

const sendGeoRejection = (res, result) => res.status(result.httpStatus).json({
    success: false,
    message: result.message,
    code: result.code,
    ...(result.details ? { details: result.details } : {}),
    timestamp: new Date().toISOString()
});

const LOCATION_FIELDS = [
    'latitude', 'longitude', 'accuracy', 'office', 'officeName', 'distanceMeters', 'validationStatus',
    'policyMode', 'reviewStatus', 'exceptionReason', 'reviewedBy', 'reviewedAt', 'reviewRemarks', 'locationPurgedAt'
];

// The location part of a checkIn/checkOut subdocument, or null when the
// punch carries no location metadata (legacy record / not punched).
const pickPunchLocation = (punch) => {
    if (!punch || !punch.time) return null;
    const src = punch.toObject ? punch.toObject() : punch;
    const out = {};
    let any = false;
    LOCATION_FIELDS.forEach((key) => {
        if (src[key] !== undefined && src[key] !== null) {
            out[key] = src[key];
            any = true;
        }
    });
    return any ? out : null;
};

// What the employee dashboard needs to know before attempting a punch.
const getGeoContextForUser = async (user) => {
    const [policy, offices] = await Promise.all([
        getEffectivePolicy(user.company),
        getActiveOfficesForUser(user._id || user.id)
    ]);
    return {
        checkInMode: policy.checkInMode,
        checkOutMode: policy.checkOutMode,
        allowExceptions: !!policy.allowExceptions,
        maxAccuracyMeters: policy.maxAccuracyMeters,
        locationRetentionDays: policy.locationRetentionDays,
        offices: offices.map((o) => ({
            id: o._id,
            name: o.name,
            address: o.address,
            latitude: o.latitude,
            longitude: o.longitude,
            radiusMeters: o.radiusMeters,
            isPrimary: o.isPrimary,
            allowCheckIn: o.allowCheckIn !== false,
            allowCheckOut: o.allowCheckOut !== false
        }))
    };
};

// Parses an assignment's date-only (YYYY-MM-DD) bound in the business
// timezone: effectiveFrom starts at 00:00, effectiveTo runs to 23:59:59.
const parseEffectiveDate = (value, bound) => {
    if (isBlank(value)) return null;
    const m = moment.tz(value, moment.ISO_8601, TZ);
    if (!m.isValid()) return undefined;
    return (bound === 'end' ? m.endOf('day') : m.startOf('day')).toDate();
};

// Strips coordinates (not the attendance itself) from records older than
// each company's locationRetentionDays. Run via `npm run geo:purge-locations`.
const purgeExpiredLocationData = async (now = new Date()) => {
    const policies = await AttendanceGeoPolicy.find().lean();
    const platform = policies.find((p) => !p.company) || DEFAULT_POLICY;
    const companyPolicies = policies.filter((p) => p.company);

    const targets = [
        ...companyPolicies.map((p) => ({ filter: { company: p.company }, days: p.locationRetentionDays })),
        { filter: { company: { $nin: companyPolicies.map((p) => p.company) } }, days: platform.locationRetentionDays }
    ];

    let purged = 0;
    for (const target of targets) {
        const cutoff = moment(now).subtract(target.days, 'days').toDate();
        for (const punch of ['checkIn', 'checkOut']) {
            const result = await AttendanceRecord.updateMany(
                {
                    ...target.filter,
                    date: { $lt: cutoff },
                    $or: [{ [`${punch}.latitude`]: { $ne: null } }, { [`${punch}.longitude`]: { $ne: null } }]
                },
                {
                    $unset: { [`${punch}.latitude`]: '', [`${punch}.longitude`]: '', [`${punch}.accuracy`]: '' },
                    $set: { [`${punch}.locationPurgedAt`]: now }
                }
            );
            purged += result.modifiedCount;
        }
    }
    if (purged) logger.info(`Purged GPS coordinates from ${purged} attendance punch(es) past retention`);
    return purged;
};

module.exports = {
    DEFAULT_POLICY,
    distanceMeters,
    parseCoordinates,
    getEffectivePolicy,
    activeAssignmentFilter,
    getActiveOfficesForUser,
    evaluatePunch,
    sendGeoRejection,
    pickPunchLocation,
    getGeoContextForUser,
    parseEffectiveDate,
    purgeExpiredLocationData
};
