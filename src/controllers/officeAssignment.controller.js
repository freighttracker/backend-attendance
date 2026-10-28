const mongoose = require('mongoose');
const User = require('../models/User');
const OfficeLocation = require('../models/OfficeLocation');
const EmployeeOfficeAssignment = require('../models/EmployeeOfficeAssignment');
const { canAccessUser } = require('../middleware/scope.middleware');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');
const { parseEffectiveDate } = require('../services/geoAttendance.service');
const { getGeoAccess, canAccessOffice, toObjectId, writeAudit } = require('../services/geoAccess.service');

const MAX_ASSIGNMENTS = 20;

const assignmentView = (a) => ({
    _id: a._id,
    office: a.office,
    isPrimary: !!a.isPrimary,
    effectiveFrom: a.effectiveFrom,
    effectiveTo: a.effectiveTo,
    isActive: a.isActive,
    assignedBy: a.assignedBy,
    deactivatedAt: a.deactivatedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
});

const loadEmployee = async (req, res) => {

    if (!mongoose.isValidObjectId(req.params.id)) {
        errorResponse(res, 'Invalid employee id', 400);
        return null;
    }

    const employee = await User.findById(req.params.id).select('firstName lastName employeeCode company subCompany role isActive');

    if (!employee) {
        errorResponse(res, 'Employee not found', 404);
        return null;
    }
    
    return employee;
};

// @desc    List an employee's office assignments
// @route   GET /api/users/:id/office-assignments
// @access  Private (the employee themself, or an admin in scope)
exports.getAssignments = async (req, res) => {

    try {

        const employee = await loadEmployee(req, res);
        if (!employee) return undefined;
        const isSelf = String(employee._id) === String(req.user._id);
        let access = null;

        if (!isSelf) {
            if (!canAccessUser(req, employee)) return errorResponse(res, 'Access denied. This employee is outside your scope.', 403);
            access = await getGeoAccess(req);
            if (!access.permissions.canManageAssignments && !access.permissions.canViewLocations) {
                return errorResponse(res, 'Access denied. You are not authorized to view office assignments.', 403);
            }
        }

        const query = { user: employee._id };
        if (req.query.includeInactive !== 'true') query.isActive = true;

        let assignments = await EmployeeOfficeAssignment.find(query)
            .populate('office', 'name code address latitude longitude radiusMeters isActive company subCompany allowCheckIn allowCheckOut')
            .populate('assignedBy', 'firstName lastName')
            .sort({ isActive: -1, isPrimary: -1, createdAt: -1 })
            .lean();

        if (access && access.officeIds) {
            assignments = assignments.filter((a) => a.office && access.officeIds.includes(String(a.office._id)));
        }

        return successResponse(res, {
            employee: { _id: employee._id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode },
            assignments: assignments.map(assignmentView)
        }, 'Office assignments retrieved');
    } catch (error) {
        logger.error('Get office assignments error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Validates the requested list and returns normalized rows or an error string.
const normalizeRequestedAssignments = (raw) => {
    if (!Array.isArray(raw)) return { error: 'assignments must be an array' };
    if (raw.length > MAX_ASSIGNMENTS) return { error: `At most ${MAX_ASSIGNMENTS} offices can be assigned` };

    const seen = new Set();
    const rows = [];
    for (const item of raw) {
        const officeId = item && item.officeId ? String(item.officeId) : '';
        if (!mongoose.isValidObjectId(officeId)) return { error: 'Each assignment needs a valid officeId' };
        if (seen.has(officeId)) return { error: 'The same office is listed more than once' };
        seen.add(officeId);

        const effectiveFrom = parseEffectiveDate(item.effectiveFrom, 'start');
        const effectiveTo = parseEffectiveDate(item.effectiveTo, 'end');
        if (effectiveFrom === undefined || effectiveTo === undefined) return { error: 'Effective dates must be valid dates (YYYY-MM-DD)' };
        if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) return { error: 'Effective-to date must be on or after the effective-from date' };

        rows.push({ officeId, isPrimary: item.isPrimary === true, effectiveFrom, effectiveTo });
    }

    const primaries = rows.filter((r) => r.isPrimary).length;
    if (primaries > 1) return { error: 'Only one office can be the primary office' };
    return { rows };
};

// @desc    Replace an employee's office assignments (within the caller's offices)
// @route   PUT /api/users/:id/office-assignments
// @access  Private/Admin (canManageAssignments)
exports.setAssignments = async (req, res) => {
    const session = await mongoose.startSession();
    try {
        const employee = await loadEmployee(req, res);
        if (!employee) return undefined;
        if (!canAccessUser(req, employee)) return errorResponse(res, 'Access denied. This employee is outside your scope.', 403);
        if (employee.isActive === false) return errorResponse(res, 'Cannot assign offices to an inactive employee', 400);

        const access = await getGeoAccess(req);
        const normalized = normalizeRequestedAssignments(req.body.assignments);
        if (normalized.error) return errorResponse(res, normalized.error, 400);
        const { rows } = normalized;

        const offices = await OfficeLocation.find({ _id: { $in: rows.map((r) => toObjectId(r.officeId)) } }).lean();
        const officeMap = new Map(offices.map((o) => [String(o._id), o]));
        
        for (const row of rows) {
            const office = officeMap.get(row.officeId);
            if (!office) return errorResponse(res, 'Office not found', 404);
            if (!canAccessOffice(req, access, office)) return errorResponse(res, `Access denied for office "${office.name}"`, 403);
            if (!office.isActive) return errorResponse(res, `Office "${office.name}" is inactive and cannot be assigned`, 400);
            // An office must belong to the employee's own company (and their
            // subcompany, when the office is subcompany-specific).
            if (String(office.company || '') !== String(employee.company || '')) {
                return errorResponse(res, `Office "${office.name}" belongs to a different company than this employee`, 400);
            }
            if (office.subCompany && String(office.subCompany) !== String(employee.subCompany || '')) {
                return errorResponse(res, `Office "${office.name}" belongs to a different subcompany than this employee`, 400);
            }
        }

        const existing = await EmployeeOfficeAssignment.find({ user: employee._id, isActive: true }).lean();
        // An office-restricted admin only manages assignments to their own
        // offices; anything else is left exactly as it is.
        const managed = existing.filter((a) => !access.officeIds || access.officeIds.includes(String(a.office)));
        const preserved = existing.filter((a) => !managed.includes(a));
        const preservedPrimary = preserved.some((a) => a.isPrimary);

        if (rows.length && !preservedPrimary && !rows.some((r) => r.isPrimary)) rows[0].isPrimary = true;
        if (preservedPrimary && rows.some((r) => r.isPrimary)) {
            return errorResponse(res, 'This employee\'s primary office is managed by another administrator', 403);
        }

        const managedByOffice = new Map(managed.map((a) => [String(a.office), a]));
        const requestedIds = new Set(rows.map((r) => r.officeId));
        const now = new Date();

        await session.withTransaction(async () => {
            const toDeactivate = managed.filter((a) => !requestedIds.has(String(a.office))).map((a) => a._id);
            if (toDeactivate.length) {
                await EmployeeOfficeAssignment.updateMany(
                    { _id: { $in: toDeactivate } },
                    { $set: { isActive: false, isPrimary: false, deactivatedBy: req.user._id, deactivatedAt: now } },
                    { session }
                );
            }
            // Clear primaries first so the new primary never collides mid-update.
            if (rows.some((r) => r.isPrimary)) {
                await EmployeeOfficeAssignment.updateMany(
                    { user: employee._id, isActive: true, isPrimary: true },
                    { $set: { isPrimary: false } },
                    { session }
                );
            }
            for (const row of rows) {
                const current = managedByOffice.get(row.officeId);
                const values = { isPrimary: row.isPrimary, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo };
                if (current) {
                    await EmployeeOfficeAssignment.updateOne({ _id: current._id }, { $set: values }, { session });
                } else {
                    await EmployeeOfficeAssignment.create([{
                        user: employee._id,
                        office: row.officeId,
                        company: employee.company || null,
                        ...values,
                        isActive: true,
                        assignedBy: req.user._id
                    }], { session });
                }
            }
        });

        const summarize = (list) => list.map((a) => ({
            office: String(a.office || a.officeId),
            isPrimary: !!a.isPrimary,
            effectiveFrom: a.effectiveFrom || null,
            effectiveTo: a.effectiveTo || null
        }));
        await writeAudit(req, {
            action: 'office_assignment.set',
            entityType: 'EmployeeOfficeAssignment',
            entityId: employee._id,
            company: employee.company,
            oldValues: { assignments: summarize(managed) },
            newValues: { assignments: summarize(rows) }
        });

        const updated = await EmployeeOfficeAssignment.find({ user: employee._id, isActive: true })
            .populate('office', 'name code address latitude longitude radiusMeters isActive')
            .sort({ isPrimary: -1, createdAt: -1 })
            .lean();

        return successResponse(res, { assignments: updated.map(assignmentView) }, 'Office assignments saved');
    } catch (error) {
        if (error.code === 11000) return errorResponse(res, 'Another update to this employee\'s offices happened at the same time. Please retry.', 409);
        logger.error('Set office assignments error:', error);
        return errorResponse(res, error.message, 500);
    } finally {
        await session.endSession();
    }
};
