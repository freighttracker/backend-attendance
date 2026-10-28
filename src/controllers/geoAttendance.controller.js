const mongoose = require('mongoose');
const moment = require('moment-timezone');
const AttendanceRecord = require('../models/AttendanceRecord');
const AttendanceGeoPolicy = require('../models/AttendanceGeoPolicy');
const EmployeeOfficeAssignment = require('../models/EmployeeOfficeAssignment');
const AuditLog = require('../models/AuditLog');
const Company = require('../models/Company');
const User = require('../models/User');
const { scopeFilter, canAccessUser } = require('../middleware/scope.middleware');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');
const { getEffectivePolicy, pickPunchLocation } = require('../services/geoAttendance.service');
const { getGeoAccess, userIdsAssignedToOffices, toObjectId, writeAudit } = require('../services/geoAccess.service');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';
const { LOCATION_VALIDATION_STATUSES, LOCATION_REVIEW_STATUSES } = AttendanceRecord;
const PUNCHES = ['checkIn', 'checkOut'];
const GEO_AUDIT_ENTITY_TYPES = ['OfficeLocation', 'EmployeeOfficeAssignment', 'AttendanceGeoPolicy', 'OfficeAdminPermission', 'AttendanceLocation', 'AttendanceRecord'];

const OFFICE_POPULATE = 'name code address latitude longitude radiusMeters isActive';

const recordView = (record, primaryOfficeByUser) => ({
    _id: record._id,
    date: record.date,
    status: record.status,
    isLocked: !!record.isLocked,
    isCorrected: !!record.isCorrected,
    user: record.user,
    primaryOffice: record.user ? primaryOfficeByUser.get(String(record.user._id)) || null : null,
    checkIn: record.checkIn && record.checkIn.time ? { time: record.checkIn.time, ...(pickPunchLocation(record.checkIn) || {}) } : null,
    checkOut: record.checkOut && record.checkOut.time ? { time: record.checkOut.time, ...(pickPunchLocation(record.checkOut) || {}) } : null
});

const primaryOfficesFor = async (userIds) => {
    const rows = await EmployeeOfficeAssignment.find({ user: { $in: userIds }, isActive: true, isPrimary: true })
        .populate('office', 'name code')
        .lean();
    return new Map(rows.filter((r) => r.office).map((r) => [String(r.user), r.office]));
};

// Restricts a record query to an office-limited admin's offices: records
// stamped with one of them, or by an employee currently assigned to one.
const officeRestriction = async (access) => {
    if (!access.officeIds) return null;
    const ids = access.officeIds.map(toObjectId);
    const users = await userIdsAssignedToOffices(access.officeIds);
    return { $or: [{ 'checkIn.office': { $in: ids } }, { 'checkOut.office': { $in: ids } }, { user: { $in: users } }] };
};

// @desc    Attendance records with check-in/check-out locations (admin monitoring)
// @route   GET /api/attendance/locations
// @access  Private/Admin (canViewLocations)
exports.getAttendanceLocations = async (req, res) => {
    try {
        const { page = 1, limit = 50, startDate, endDate, userId, department, officeId, validationStatus, reviewStatus } = req.query;
        const access = await getGeoAccess(req);

        const and = [{ ...scopeFilter(req) }, { 'checkIn.time': { $ne: null } }];

        const start = startDate ? moment.tz(startDate, TZ) : moment.tz(TZ).subtract(6, 'days');
        const end = endDate ? moment.tz(endDate, TZ) : moment.tz(TZ);
        if (!start.isValid() || !end.isValid()) return errorResponse(res, 'Invalid date range', 400);
        if (end.isBefore(start)) return errorResponse(res, 'End date must be on or after start date', 400);
        // Records are dated at server-local midnight (see attendance.controller's
        // toRecordDate note), so widen by a day on each side and let the
        // TZ-correct bounds below do the precise cut.
        and.push({ date: { $gte: start.clone().startOf('day').subtract(1, 'day').toDate(), $lte: end.clone().endOf('day').toDate() } });
        and.push({ 'checkIn.time': { $gte: start.clone().startOf('day').toDate(), $lte: end.clone().endOf('day').toDate() } });

        if (userId) {
            if (!mongoose.isValidObjectId(userId)) return errorResponse(res, 'Invalid userId', 400);
            and.push({ user: toObjectId(userId) });
        }
        if (department) {
            const deptUsers = await User.find({ ...scopeFilter(req), department }).distinct('_id');
            and.push({ user: { $in: deptUsers } });
        }
        if (officeId) {
            if (!mongoose.isValidObjectId(officeId)) return errorResponse(res, 'Invalid officeId', 400);
            if (access.officeIds && !access.officeIds.includes(String(officeId))) {
                return errorResponse(res, 'Access denied for this office', 403);
            }
            const oid = toObjectId(officeId);
            and.push({ $or: [{ 'checkIn.office': oid }, { 'checkOut.office': oid }] });
        }
        if (validationStatus) {
            if (!LOCATION_VALIDATION_STATUSES.includes(validationStatus)) return errorResponse(res, 'Invalid validationStatus', 400);
            and.push({ $or: [{ 'checkIn.validationStatus': validationStatus }, { 'checkOut.validationStatus': validationStatus }] });
        }
        if (reviewStatus) {
            if (!LOCATION_REVIEW_STATUSES.includes(reviewStatus)) return errorResponse(res, 'Invalid reviewStatus', 400);
            and.push({ $or: [{ 'checkIn.reviewStatus': reviewStatus }, { 'checkOut.reviewStatus': reviewStatus }] });
        }
        const restriction = await officeRestriction(access);
        if (restriction) and.push(restriction);

        const query = { $and: and };
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);

        const total = await AttendanceRecord.countDocuments(query);
        const records = await AttendanceRecord.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .populate('checkIn.office', OFFICE_POPULATE)
            .populate('checkOut.office', OFFICE_POPULATE)
            .sort({ 'checkIn.time': -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .lean();

        const primaryMap = await primaryOfficesFor(records.filter((r) => r.user).map((r) => r.user._id));

        return paginatedResponse(res, records.map((r) => recordView(r, primaryMap)), {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.max(Math.ceil(total / limitNum), 1)
        });
    } catch (error) {
        logger.error('Get attendance locations error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Loads a record and checks the caller may see its location: the employee
// themself, or an admin with canViewLocations whose scope covers it.
const loadRecordForLocation = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        errorResponse(res, 'Invalid attendance record id', 400);
        return null;
    }
    const record = await AttendanceRecord.findById(req.params.id)
        .populate('user', 'firstName lastName employeeCode department company subCompany')
        .populate('checkIn.office', OFFICE_POPULATE)
        .populate('checkOut.office', OFFICE_POPULATE)
        .populate('checkIn.reviewedBy', 'firstName lastName')
        .populate('checkOut.reviewedBy', 'firstName lastName');
    if (!record) {
        errorResponse(res, 'Attendance record not found', 404);
        return null;
    }
    return record;
};

const adminCanSeeRecord = async (req, access, record) => {
    if (!access.permissions.canViewLocations) return false;
    if (!record.user || !canAccessUser(req, record.user)) return false;
    if (!access.officeIds) return true;
    const stamped = PUNCHES.map((p) => record[p] && record[p].office && String(record[p].office._id || record[p].office)).filter(Boolean);
    if (stamped.some((id) => access.officeIds.includes(id))) return true;
    const assigned = await EmployeeOfficeAssignment.exists({ user: record.user._id, office: { $in: access.officeIds.map(toObjectId) }, isActive: true });
    return !!assigned;
};

// @desc    One attendance record's check-in/check-out location detail
// @route   GET /api/attendance/:id/location
// @access  Private (own record, or admin with canViewLocations in scope)
exports.getAttendanceLocation = async (req, res) => {
    try {
        const record = await loadRecordForLocation(req, res);
        if (!record) return undefined;

        const isOwn = record.user && String(record.user._id) === String(req.user._id);
        if (!isOwn) {
            const isAdminRole = ['superadmin', 'admin', 'company_admin', 'subcompany_admin'].includes(req.user.role);
            const access = isAdminRole ? await getGeoAccess(req) : null;
            if (!access || !(await adminCanSeeRecord(req, access, record))) {
                return errorResponse(res, 'Access denied. You cannot view this attendance location.', 403);
            }
        }

        const primaryMap = record.user ? await primaryOfficesFor([record.user._id]) : new Map();
        return successResponse(res, recordView(record.toObject(), primaryMap), 'Attendance location retrieved');
    } catch (error) {
        logger.error('Get attendance location error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve / reject a flagged check-in or check-out location
// @route   PUT /api/attendance/:id/location-review
// @access  Private/Admin (canReviewExceptions)
exports.reviewAttendanceLocation = async (req, res) => {
    try {
        const { punch, decision, remarks } = req.body;
        if (!PUNCHES.includes(punch)) return errorResponse(res, 'punch must be checkIn or checkOut', 400);
        if (!['approved', 'rejected'].includes(decision)) return errorResponse(res, 'decision must be approved or rejected', 400);
        const trimmedRemarks = typeof remarks === 'string' ? remarks.trim().slice(0, 500) : '';
        if (decision === 'rejected' && !trimmedRemarks) return errorResponse(res, 'Remarks are required when rejecting', 400);

        const record = await loadRecordForLocation(req, res);
        if (!record) return undefined;

        const access = await getGeoAccess(req);
        // Reviewing requires seeing the record too, so reuse the same check
        // with the review flag standing in for the view flag.
        const reviewAccess = { ...access, permissions: { ...access.permissions, canViewLocations: access.permissions.canReviewExceptions } };
        if (!(await adminCanSeeRecord(req, reviewAccess, record))) {
            return errorResponse(res, 'Access denied. This record is outside your scope.', 403);
        }
        if (record.isLocked) return errorResponse(res, 'Attendance record is locked', 400);
        if (!record[punch] || !record[punch].time) return errorResponse(res, `This record has no ${punch === 'checkIn' ? 'check-in' : 'check-out'}`, 400);
        if (record[punch].reviewStatus !== 'pending') {
            return errorResponse(res, 'Only a pending location exception can be reviewed', 409);
        }

        // Conditional update so two reviewers can't both decide the same punch.
        const now = new Date();
        const updated = await AttendanceRecord.findOneAndUpdate(
            { _id: record._id, [`${punch}.reviewStatus`]: 'pending' },
            {
                $set: {
                    [`${punch}.reviewStatus`]: decision,
                    [`${punch}.reviewedBy`]: req.user._id,
                    [`${punch}.reviewedAt`]: now,
                    [`${punch}.reviewRemarks`]: trimmedRemarks || undefined
                }
            },
            { new: true }
        );
        if (!updated) return errorResponse(res, 'This exception was already reviewed', 409);

        await writeAudit(req, {
            action: `attendance_location.${decision === 'approved' ? 'approve' : 'reject'}`,
            entityType: 'AttendanceLocation',
            entityId: record._id,
            company: record.company,
            oldValues: { punch, reviewStatus: 'pending', validationStatus: record[punch].validationStatus },
            newValues: { punch, reviewStatus: decision, remarks: trimmedRemarks || undefined }
        });

        return successResponse(res, { _id: updated._id, punch, reviewStatus: decision }, decision === 'approved'
            ? 'Location exception approved'
            : 'Location exception rejected. Use Corrections if the day\'s attendance also needs adjusting.');
    } catch (error) {
        logger.error('Review attendance location error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Which company's policy the caller is reading/writing. A superadmin picks
// one via ?companyId= (or edits the platform default with none); everyone
// else is pinned to their own company.
const policyCompanyFor = (req) => (req.user.role === 'superadmin' ? (req.query.companyId || null) : (req.user.company || null));

// @desc    Effective geofencing policy
// @route   GET /api/attendance/geo-policy
// @access  Private/Admin
exports.getGeoPolicy = async (req, res) => {
    try {
        const companyId = policyCompanyFor(req);
        const policy = await getEffectivePolicy(companyId);
        return successResponse(res, policy, 'Geofencing policy retrieved');
    } catch (error) {
        logger.error('Get geo policy error:', error);
        return errorResponse(res, error.message, 500);
    }
};

const POLICY_FIELDS = ['checkInMode', 'checkOutMode', 'defaultRadiusMeters', 'maxAccuracyMeters', 'allowExceptions', 'locationRetentionDays'];

// @desc    Save the geofencing policy
// @route   PUT /api/attendance/geo-policy
// @access  Private/superadmin, admin, company_admin (canManageOffices)
exports.updateGeoPolicy = async (req, res) => {
    try {
        const companyId = policyCompanyFor(req);
        if (companyId && !(await Company.exists({ _id: companyId }))) return errorResponse(res, 'Company not found', 404);

        const update = {};
        POLICY_FIELDS.forEach((key) => {
            if (req.body[key] !== undefined) update[key] = req.body[key];
        });
        update.updatedBy = req.user._id;

        const before = await getEffectivePolicy(companyId);
        const saved = await AttendanceGeoPolicy.findOneAndUpdate(
            { company: companyId },
            { $set: update, $setOnInsert: { company: companyId } },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );

        const oldValues = {};
        const newValues = {};
        POLICY_FIELDS.forEach((key) => {
            if (String(before[key]) !== String(saved[key])) {
                oldValues[key] = before[key];
                newValues[key] = saved[key];
            }
        });
        await writeAudit(req, {
            action: 'geo_policy.update',
            entityType: 'AttendanceGeoPolicy',
            entityId: saved._id,
            company: companyId,
            oldValues,
            newValues
        });

        return successResponse(res, { ...saved.toObject(), source: companyId ? 'company' : 'platform' }, 'Geofencing policy saved');
    } catch (error) {
        if (error.name === 'ValidationError') {
            return errorResponse(res, 'Validation Error', 400, Object.values(error.errors).map((e) => e.message));
        }
        logger.error('Update geo policy error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Audit trail for office/assignment/policy/permission/exception changes
// @route   GET /api/attendance/geo-audit-logs
// @access  Private/superadmin, admin, company_admin
exports.getGeoAuditLogs = async (req, res) => {
    try {
        const { page = 1, limit = 50, entityType, startDate, endDate } = req.query;
        const query = { entityType: { $in: GEO_AUDIT_ENTITY_TYPES } };
        if (entityType) {
            if (!GEO_AUDIT_ENTITY_TYPES.includes(entityType)) return errorResponse(res, 'Invalid entityType', 400);
            query.entityType = entityType;
        }
        if (req.scope.companyId) query.company = toObjectId(req.scope.companyId);
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = moment.tz(startDate, TZ).startOf('day').toDate();
            if (endDate) query.createdAt.$lte = moment.tz(endDate, TZ).endOf('day').toDate();
        }

        const pageNum = Math.max(parseInt(page) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
        const total = await AuditLog.countDocuments(query);
        const logs = await AuditLog.find(query)
            .populate('user', 'firstName lastName email role')
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .lean();

        return paginatedResponse(res, logs, {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.max(Math.ceil(total / limitNum), 1)
        });
    } catch (error) {
        logger.error('Get geo audit logs error:', error);
        return errorResponse(res, error.message, 500);
    }
};
