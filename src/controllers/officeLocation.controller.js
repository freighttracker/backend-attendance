const OfficeLocation = require('../models/OfficeLocation');
const EmployeeOfficeAssignment = require('../models/EmployeeOfficeAssignment');
const OfficeAdminPermission = require('../models/OfficeAdminPermission');
const Company = require('../models/Company');
const SubCompany = require('../models/SubCompany');
const User = require('../models/User');
const { canAccessUser } = require('../middleware/scope.middleware');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');
const { getEffectivePolicy } = require('../services/geoAttendance.service');
const {
    PERMISSION_FLAGS,
    ROLE_DEFAULTS,
    CONFIGURABLE_ADMIN_ROLES,
    getGeoAccess,
    officeScopeFilter,
    canAccessOffice,
    toObjectId,
    writeAudit
} = require('../services/geoAccess.service');

const EDITABLE_FIELDS = ['name', 'code', 'address', 'latitude', 'longitude', 'radiusMeters', 'maxAccuracyMeters', 'allowCheckIn', 'allowCheckOut'];

const pickEditable = (source) => {
    const out = {};
    EDITABLE_FIELDS.forEach((key) => {
        if (source[key] !== undefined) out[key] = source[key];
    });
    if (out.code === '') out.code = undefined;
    return out;
};

const isNullIsland = (lat, lon) => Number(lat) === 0 && Number(lon) === 0;

// @desc    List office locations within the caller's scope
// @route   GET /api/office-locations
// @access  Private/Admin
exports.listOffices = async (req, res) => {
    try {
        const { page = 1, limit = 50, search, isActive } = req.query;
        const access = await getGeoAccess(req);
        const query = officeScopeFilter(req, access);

        if (search) {
            const re = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [{ name: re }, { code: re }, { address: re }];
        }
        if (isActive !== undefined && isActive !== '') query.isActive = isActive === 'true';

        const pageNum = Math.max(parseInt(page) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
        const total = await OfficeLocation.countDocuments(query);
        const offices = await OfficeLocation.find(query)
            .populate('company', 'name code')
            .populate('subCompany', 'name code')
            .populate('createdBy', 'firstName lastName')
            .sort({ isActive: -1, name: 1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .lean();

        const counts = await EmployeeOfficeAssignment.aggregate([
            { $match: { office: { $in: offices.map((o) => o._id) }, isActive: true } },
            { $group: { _id: '$office', count: { $sum: 1 } } }
        ]);
        const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

        return paginatedResponse(res, offices.map((o) => ({ ...o, assignedCount: countMap.get(String(o._id)) || 0 })), {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.max(Math.ceil(total / limitNum), 1)
        });
    } catch (error) {
        logger.error('List office locations error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get one office location
// @route   GET /api/office-locations/:id
// @access  Private/Admin
exports.getOffice = async (req, res) => {
    try {
        const office = await OfficeLocation.findById(req.params.id)
            .populate('company', 'name code')
            .populate('subCompany', 'name code')
            .populate('createdBy', 'firstName lastName')
            .populate('updatedBy', 'firstName lastName');
        if (!office) return errorResponse(res, 'Office location not found', 404);

        const access = await getGeoAccess(req);
        if (!canAccessOffice(req, access, { ...office.toObject(), company: office.company?._id, subCompany: office.subCompany?._id })) {
            return errorResponse(res, 'Access denied. This office is outside your scope.', 403);
        }

        const assignedCount = await EmployeeOfficeAssignment.countDocuments({ office: office._id, isActive: true });
        return successResponse(res, { ...office.toObject(), assignedCount }, 'Office location retrieved');
    } catch (error) {
        logger.error('Get office location error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Works out which company/subcompany a new office belongs to. Only a
// superadmin may choose the company; everyone else is pinned to their own.
const resolveOfficeTenant = async (req) => {
    const role = req.user.role;
    let company = req.user.company || null;
    let subCompany = null;

    if (role === 'superadmin') {
        company = req.body.companyId || null;
        if (company && !(await Company.exists({ _id: company }))) {
            return { error: 'Company not found' };
        }
    }

    if (role === 'subcompany_admin') {
        subCompany = req.user.subCompany || null;
    } else if (req.body.subCompanyId) {
        const sub = await SubCompany.findById(req.body.subCompanyId).lean();
        if (!sub || (company && String(sub.company) !== String(company))) {
            return { error: 'Subcompany not found in this company' };
        }
        company = company || sub.company;
        subCompany = sub._id;
    }

    return { company, subCompany };
};

// @desc    Create an office location
// @route   POST /api/office-locations
// @access  Private/Admin (canManageOffices)
exports.createOffice = async (req, res) => {
    try {
        const tenant = await resolveOfficeTenant(req);
        if (tenant.error) return errorResponse(res, tenant.error, 400);

        const fields = pickEditable(req.body);
        if (isNullIsland(fields.latitude, fields.longitude)) {
            return errorResponse(res, 'Coordinates 0,0 are not a valid office location', 400);
        }
        if (fields.radiusMeters === undefined) {
            const policy = await getEffectivePolicy(tenant.company);
            fields.radiusMeters = policy.defaultRadiusMeters;
        }

        const office = await OfficeLocation.create({
            ...fields,
            company: tenant.company,
            subCompany: tenant.subCompany,
            isActive: req.body.isActive !== false,
            createdBy: req.user._id,
            updatedBy: req.user._id
        });

        await writeAudit(req, {
            action: 'office_location.create',
            entityType: 'OfficeLocation',
            entityId: office._id,
            company: office.company,
            newValues: office.toObject()
        });

        return successResponse(res, office, 'Office location created', 201);
    } catch (error) {
        if (error.code === 11000) return errorResponse(res, 'An office with this code already exists', 409);
        if (error.name === 'ValidationError') {
            return errorResponse(res, 'Validation Error', 400, Object.values(error.errors).map((e) => e.message));
        }
        logger.error('Create office location error:', error);
        return errorResponse(res, error.message, 500);
    }
};

const loadOfficeInScope = async (req, res) => {
    const office = await OfficeLocation.findById(req.params.id);
    if (!office) {
        errorResponse(res, 'Office location not found', 404);
        return null;
    }
    const access = await getGeoAccess(req);
    if (!canAccessOffice(req, access, office)) {
        errorResponse(res, 'Access denied. This office is outside your scope.', 403);
        return null;
    }
    return office;
};

// @desc    Update an office location
// @route   PUT /api/office-locations/:id
// @access  Private/Admin (canManageOffices)
exports.updateOffice = async (req, res) => {
    try {
        const office = await loadOfficeInScope(req, res);
        if (!office) return undefined;

        const fields = pickEditable(req.body);
        const nextLat = fields.latitude !== undefined ? fields.latitude : office.latitude;
        const nextLon = fields.longitude !== undefined ? fields.longitude : office.longitude;
        if (isNullIsland(nextLat, nextLon)) {
            return errorResponse(res, 'Coordinates 0,0 are not a valid office location', 400);
        }

        const before = office.toObject();
        Object.assign(office, fields);
        if (req.body.code === '' || req.body.code === null) office.code = undefined;
        office.updatedBy = req.user._id;
        await office.save();

        const changed = {};
        const previous = {};
        Object.keys(fields).forEach((key) => {
            if (String(before[key]) !== String(office[key])) {
                previous[key] = before[key];
                changed[key] = office[key];
            }
        });

        await writeAudit(req, {
            action: 'office_location.update',
            entityType: 'OfficeLocation',
            entityId: office._id,
            company: office.company,
            oldValues: previous,
            newValues: changed
        });

        return successResponse(res, office, 'Office location updated');
    } catch (error) {
        if (error.code === 11000) return errorResponse(res, 'An office with this code already exists', 409);
        if (error.name === 'ValidationError') {
            return errorResponse(res, 'Validation Error', 400, Object.values(error.errors).map((e) => e.message));
        }
        logger.error('Update office location error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Activate / deactivate an office location
// @route   PUT /api/office-locations/:id/status
// @access  Private/Admin (canManageOffices)
exports.setOfficeStatus = async (req, res) => {
    try {
        const office = await loadOfficeInScope(req, res);
        if (!office) return undefined;

        const isActive = req.body.isActive === true || req.body.isActive === 'true';
        if (office.isActive === isActive) {
            return successResponse(res, office, `Office is already ${isActive ? 'active' : 'inactive'}`);
        }

        office.isActive = isActive;
        office.updatedBy = req.user._id;
        await office.save();

        await writeAudit(req, {
            action: isActive ? 'office_location.activate' : 'office_location.deactivate',
            entityType: 'OfficeLocation',
            entityId: office._id,
            company: office.company,
            oldValues: { isActive: !isActive },
            newValues: { isActive }
        });

        // Assignments are kept; check-in simply stops accepting an inactive office.
        return successResponse(res, office, isActive ? 'Office activated' : 'Office deactivated - it no longer accepts attendance');
    } catch (error) {
        logger.error('Set office status error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// ---- Office-admin permissions ----

const effectivePermissionView = (adminUser, custom) => {
    const defaults = ROLE_DEFAULTS[adminUser.role] || {};
    const flags = {};
    PERMISSION_FLAGS.forEach((flag) => { flags[flag] = custom ? !!custom[flag] : !!defaults[flag]; });
    return {
        admin: {
            _id: adminUser._id,
            firstName: adminUser.firstName,
            lastName: adminUser.lastName,
            email: adminUser.email,
            employeeCode: adminUser.employeeCode,
            role: adminUser.role,
            company: adminUser.company,
            subCompany: adminUser.subCompany
        },
        isCustom: !!custom,
        offices: custom ? custom.offices || [] : [],
        ...flags,
        updatedAt: custom ? custom.updatedAt : null
    };
};

// @desc    List admins in scope with their effective location permissions
// @route   GET /api/office-locations/admin-permissions
// @access  Private/superadmin, admin, company_admin
exports.listAdminPermissions = async (req, res) => {
    try {
        const filter = { role: { $in: CONFIGURABLE_ADMIN_ROLES }, isActive: true };
        if (req.scope.companyId) filter.company = req.scope.companyId;

        const admins = await User.find(filter)
            .select('firstName lastName email employeeCode role company subCompany')
            .sort({ firstName: 1 })
            .limit(500)
            .lean();
        const customs = await OfficeAdminPermission.find({ admin: { $in: admins.map((a) => a._id) } })
            .populate('offices', 'name code isActive')
            .lean();
        const customMap = new Map(customs.map((c) => [String(c.admin), c]));

        return successResponse(res, admins.map((a) => effectivePermissionView(a, customMap.get(String(a._id)))), 'Admin permissions retrieved');
    } catch (error) {
        logger.error('List admin permissions error:', error);
        return errorResponse(res, error.message, 500);
    }
};

const loadManagedAdmin = async (req, res) => {
    const target = await User.findById(req.params.userId).select('firstName lastName email employeeCode role company subCompany');
    if (!target) {
        errorResponse(res, 'Admin user not found', 404);
        return null;
    }
    if (!CONFIGURABLE_ADMIN_ROLES.includes(target.role)) {
        errorResponse(res, 'Location permissions can only be set for admin accounts', 400);
        return null;
    }
    if (String(target._id) === String(req.user._id)) {
        errorResponse(res, 'You cannot change your own location permissions', 403);
        return null;
    }
    if (!canAccessUser(req, target)) {
        errorResponse(res, 'Access denied. This admin is outside your scope.', 403);
        return null;
    }
    // A company admin may only configure admins below the company level.
    if (req.user.role === 'company_admin' && target.role !== 'subcompany_admin') {
        errorResponse(res, 'Company admins can only configure subcompany admins', 403);
        return null;
    }
    return target;
};

// @desc    Set an admin's location permissions (replaces role defaults)
// @route   PUT /api/office-locations/admin-permissions/:userId
// @access  Private/superadmin, admin, company_admin
exports.setAdminPermission = async (req, res) => {
    try {
        const target = await loadManagedAdmin(req, res);
        if (!target) return undefined;

        const officeIds = Array.isArray(req.body.offices) ? [...new Set(req.body.offices.map(String))] : [];
        if (officeIds.length) {
            const offices = await OfficeLocation.find({ _id: { $in: officeIds.map(toObjectId) } }).lean();
            if (offices.length !== officeIds.length) return errorResponse(res, 'One or more offices were not found', 400);
            const foreign = offices.find((o) => target.company && String(o.company || '') !== String(target.company));
            if (foreign) return errorResponse(res, `Office "${foreign.name}" belongs to a different company`, 400);
        }

        const update = { company: target.company || null, offices: officeIds, grantedBy: req.user._id };
        PERMISSION_FLAGS.forEach((flag) => { update[flag] = req.body[flag] === true; });

        const before = await OfficeAdminPermission.findOne({ admin: target._id }).lean();
        const saved = await OfficeAdminPermission.findOneAndUpdate(
            { admin: target._id },
            { $set: update },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).populate('offices', 'name code isActive');

        await writeAudit(req, {
            action: 'office_admin_permission.set',
            entityType: 'OfficeAdminPermission',
            entityId: target._id,
            company: target.company,
            oldValues: before ? { offices: before.offices, ...Object.fromEntries(PERMISSION_FLAGS.map((f) => [f, before[f]])) } : { defaults: true },
            newValues: { offices: officeIds, ...Object.fromEntries(PERMISSION_FLAGS.map((f) => [f, update[f]])) }
        });

        return successResponse(res, effectivePermissionView(target, saved.toObject()), 'Admin location permissions saved');
    } catch (error) {
        logger.error('Set admin permission error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Reset an admin to their role's default location permissions
// @route   DELETE /api/office-locations/admin-permissions/:userId
// @access  Private/superadmin, admin, company_admin
exports.resetAdminPermission = async (req, res) => {
    try {
        const target = await loadManagedAdmin(req, res);
        if (!target) return undefined;

        const removed = await OfficeAdminPermission.findOneAndDelete({ admin: target._id }).lean();
        if (removed) {
            await writeAudit(req, {
                action: 'office_admin_permission.reset',
                entityType: 'OfficeAdminPermission',
                entityId: target._id,
                company: target.company,
                oldValues: { offices: removed.offices, ...Object.fromEntries(PERMISSION_FLAGS.map((f) => [f, removed[f]])) },
                newValues: { defaults: true }
            });
        }
        return successResponse(res, effectivePermissionView(target, null), 'Admin reset to default permissions');
    } catch (error) {
        logger.error('Reset admin permission error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    The caller's own effective location permissions (drives the UI)
// @route   GET /api/office-locations/my-permissions
// @access  Private/Admin
exports.getMyPermissions = async (req, res) => {
    try {
        const access = await getGeoAccess(req);
        return successResponse(res, {
            role: access.role,
            isCustom: access.isCustom,
            officeIds: access.officeIds,
            canManagePermissions: ['superadmin', 'admin', 'company_admin'].includes(access.role),
            ...access.permissions
        }, 'Permissions retrieved');
    } catch (error) {
        logger.error('Get my geo permissions error:', error);
        return errorResponse(res, error.message, 500);
    }
};
