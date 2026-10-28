const mongoose = require('mongoose');
const OfficeAdminPermission = require('../models/OfficeAdminPermission');
const EmployeeOfficeAssignment = require('../models/EmployeeOfficeAssignment');
const AuditLog = require('../models/AuditLog');
const { errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// Who may do what in the location-attendance module. This sits on top of
// attachScope (company/subcompany isolation), never instead of it.
//
// Role defaults apply when an admin has no OfficeAdminPermission document.
// A document replaces the defaults for that admin (it can narrow both the
// flags and the set of offices). superadmin is always unrestricted.
const PERMISSION_FLAGS = ['canManageOffices', 'canManageAssignments', 'canViewLocations', 'canReviewExceptions'];

const ROLE_DEFAULTS = {
    superadmin: { canManageOffices: true, canManageAssignments: true, canViewLocations: true, canReviewExceptions: true },
    admin: { canManageOffices: true, canManageAssignments: true, canViewLocations: true, canReviewExceptions: true },
    company_admin: { canManageOffices: true, canManageAssignments: true, canViewLocations: true, canReviewExceptions: true },
    subcompany_admin: { canManageOffices: false, canManageAssignments: true, canViewLocations: true, canReviewExceptions: true }
};

// Roles allowed to grant/revoke other admins' location permissions.
const PERMISSION_MANAGER_ROLES = ['superadmin', 'admin', 'company_admin'];
// Roles whose permissions can be customised.
const CONFIGURABLE_ADMIN_ROLES = ['admin', 'company_admin', 'subcompany_admin'];

const NO_ACCESS = { canManageOffices: false, canManageAssignments: false, canViewLocations: false, canReviewExceptions: false };

// Resolves (and caches on req) the caller's effective location permissions.
// officeIds === null means "every office within the caller's scope".
const getGeoAccess = async (req) => {
    if (req.geoAccess) return req.geoAccess;

    const role = req.user.role;
    const defaults = ROLE_DEFAULTS[role] || NO_ACCESS;
    let access = { role, isSuperAdmin: role === 'superadmin', permissions: { ...defaults }, officeIds: null, isCustom: false };

    if (role !== 'superadmin' && ROLE_DEFAULTS[role]) {
        const custom = await OfficeAdminPermission.findOne({ admin: req.user._id }).lean();
        if (custom) {
            const permissions = {};
            PERMISSION_FLAGS.forEach((flag) => { permissions[flag] = !!custom[flag]; });
            access = {
                ...access,
                permissions,
                officeIds: custom.offices && custom.offices.length ? custom.offices.map(String) : null,
                isCustom: true
            };
        }
    }

    req.geoAccess = access;
    return access;
};

// Passes when the caller holds ANY of the given flags.
const requireGeoPermission = (...flags) => async (req, res, next) => {
    try {
        const access = await getGeoAccess(req);
        if (!flags.some((flag) => access.permissions[flag])) {
            return errorResponse(res, 'Access denied. You are not authorized for this location-attendance action.', 403);
        }
        next();
    } catch (error) {
        logger.error('Geo permission check error:', error);
        return errorResponse(res, 'Authorization check failed', 500);
    }
};

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

// Mongo filter for offices the caller can see. Like scopeFilter, but a
// subcompany admin also sees company-wide offices (subCompany: null) since
// their staff may be assigned to the head office.
const officeScopeFilter = (req, access) => {
    const filter = {};
    if (req.scope.companyId) filter.company = toObjectId(req.scope.companyId);
    if (req.scope.subCompanyId) filter.subCompany = { $in: [toObjectId(req.scope.subCompanyId), null] };
    if (access && access.officeIds) filter._id = { $in: access.officeIds.map(toObjectId) };
    return filter;
};

const canAccessOffice = (req, access, office) => {
    if (req.scope.companyId && String(office.company || '') !== String(req.scope.companyId)) return false;
    if (req.scope.subCompanyId && office.subCompany && String(office.subCompany) !== String(req.scope.subCompanyId)) return false;
    if (access.officeIds && !access.officeIds.includes(String(office._id))) return false;
    return true;
};

// For an office-restricted admin: the employees currently assigned to any
// of their offices (so records with no office stamped are still visible).
const userIdsAssignedToOffices = async (officeIds) => {
    const rows = await EmployeeOfficeAssignment.find({ office: { $in: officeIds.map(toObjectId) }, isActive: true }).distinct('user');
    return rows;
};

// Audit entry, same pattern as company.controller's logAudit. A failed write
// is logged, never surfaced to the caller; awaiting it is optional.
const writeAudit = (req, { action, entityType, entityId, company, oldValues, newValues }) => {
    return AuditLog.create({
        user: req.user._id,
        action,
        entityType,
        entityId,
        company: company || undefined,
        oldValues,
        newValues,
        ipAddress: req.ip,
        userAgent: req.get ? req.get('user-agent') : undefined
    }).catch((err) => logger.error('Audit log write failed:', err));
};

module.exports = {
    PERMISSION_FLAGS,
    ROLE_DEFAULTS,
    PERMISSION_MANAGER_ROLES,
    CONFIGURABLE_ADMIN_ROLES,
    getGeoAccess,
    requireGeoPermission,
    officeScopeFilter,
    canAccessOffice,
    userIdsAssignedToOffices,
    toObjectId,
    writeAudit
};
