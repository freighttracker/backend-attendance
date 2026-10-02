const moment = require('moment-timezone');
const SalaryStructure = require('../models/SalaryStructure');
const User = require('../models/User');
const { scopeFilter, canAccessUser, SUPERADMIN_ROLES } = require('../middleware/scope.middleware');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

    // @desc    Get an employee's current salary structure
    // @route   GET /api/payroll/structure/:userId
    // @access  Private (self) / Private/Admin (any in scope)
    exports.getSalaryStructure = async (req, res) => {

        try {
            const { userId } = req.params;
            if (req.user.id !== userId) {
                if (!SUPERADMIN_ROLES.includes(req.user.role)) {
                    const targetUser = await User.findById(userId).select('company subCompany');
                    if (!targetUser || !canAccessUser(req, targetUser)) {
                        return errorResponse(res, 'Not authorized', 403);
                    }
                }
            }

            const structure = await SalaryStructure.findOne({ user: userId })
                .populate('createdBy', 'firstName lastName')
                .populate('updatedBy', 'firstName lastName');

            if (!structure) return errorResponse(res, 'Salary structure not configured for this employee', 404);
            return successResponse(res, structure, 'Salary structure retrieved');
        } catch (error) {
            logger.error('Get salary structure error:', error);
            return errorResponse(res, error.message, 500);
        }
    };

    // @desc    List all salary structures
    // @route   GET /api/payroll/structures
    // @access  Private/Admin (own scope only, unless superadmin)
    exports.listSalaryStructures = async (req, res) => {
        try {
            const { page = 1, limit = 20, department } = req.query;
            // req.scope pins this to the caller's own company/subcompany unless
            // they're a superadmin (who may still narrow via ?companyId=).
            const userQuery = { isActive: true, ...scopeFilter(req) };
            if (department) userQuery.department = department;

            const skip = (parseInt(page) - 1) * parseInt(limit);
            const users = await User.find(userQuery).select('_id').skip(skip).limit(parseInt(limit));
            const userIds = users.map(u => u._id);
            const total = await User.countDocuments(userQuery);

            const structures = await SalaryStructure.find({ user: { $in: userIds } })
                .populate('user', 'firstName lastName employeeCode department designation');

            return paginatedResponse(res, structures, {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            });

        } catch (error) {
            logger.error('List salary structures error:', error);
            return errorResponse(res, error.message, 500);
        }
    };

    // @desc    Create or revise an employee's salary structure. Editing an
    //          existing structure automatically archives the previous version
    //          into revisionHistory so past payroll can still be recalculated
    //          against the rules that were actually in force at the time.
    // @route   PUT /api/payroll/structure/:userId
    // @access  Private/Admin
    exports.upsertSalaryStructure = async (req, res) => {

        try {

            const { userId } = req.params;
            const { monthlyGrossSalary, annualCTC, effectiveFrom, earnings, deductions, overtime, remarks } = req.body;

            const user = await User.findById(userId);

            if (!user) return errorResponse(res, 'Employee not found', 404);

            if (!SUPERADMIN_ROLES.includes(req.user.role) && !canAccessUser(req, user)) {
                return errorResponse(res, 'Not authorized to manage this employee\'s salary structure', 403);
            }

            let structure = await SalaryStructure.findOne({ user: userId });

            if (!structure) {

                if (monthlyGrossSalary === undefined || annualCTC === undefined) {
                    return errorResponse(res, 'monthlyGrossSalary and annualCTC are required to create a salary structure', 400);
                }

                structure = await SalaryStructure.create({
                    user: userId,
                    // Always taken from the employee's own record, never the
                    // request body - a structure can never be filed under a
                    // different company than the employee it belongs to.
                    company: user.company || null,
                    subCompany: user.subCompany || null,
                    monthlyGrossSalary,
                    annualCTC,
                    effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
                    earnings,
                    deductions,
                    overtime,
                    createdBy: req.user.id,
                    updatedBy: req.user.id
                });

                logger.info(`Salary structure created for ${user.employeeCode} by ${req.user.email}`);

                return successResponse(res, structure, 'Salary structure created successfully', 201);
            }

            const newEffectiveFrom = moment(effectiveFrom ? new Date(effectiveFrom) : new Date()).startOf('day').toDate();
            const newEffectiveTo = moment(newEffectiveFrom).subtract(1, 'day').endOf('day').toDate();

            // Any archived version starting on/after the new effective date is
            // superseded entirely; one that overlaps it is cut short. Without
            // this, back-dating a correction (e.g. fixing last month's
            // components) left the stale version in force for that month.
            structure.revisionHistory = structure.revisionHistory
                .filter(r => !r.effectiveFrom || r.effectiveFrom < newEffectiveFrom)
                .map(r => {
                    if (!r.effectiveTo || r.effectiveTo >= newEffectiveFrom) r.effectiveTo = newEffectiveTo;
                    return r;
                });

            // Only archive the current version if it was actually in force
            // for some period before the new one starts - otherwise this edit
            // is a correction of it, not a revision.
            if (structure.effectiveFrom < newEffectiveFrom) {
                structure.revisionHistory.push({
                    monthlyGrossSalary: structure.monthlyGrossSalary,
                    annualCTC: structure.annualCTC,
                    earnings: structure.earnings,
                    deductions: structure.deductions,
                    overtime: structure.overtime,
                    effectiveFrom: structure.effectiveFrom,
                    effectiveTo: newEffectiveTo,
                    revisedBy: req.user.id,
                    remarks: remarks || 'Salary revised'
                });
            }

            if (monthlyGrossSalary !== undefined) structure.monthlyGrossSalary = monthlyGrossSalary;
            if (annualCTC !== undefined) structure.annualCTC = annualCTC;
            structure.effectiveFrom = newEffectiveFrom;

            if (earnings) structure.earnings = { ...structure.earnings.toObject(), ...earnings };
            if (deductions) structure.deductions = { ...structure.deductions.toObject(), ...deductions };
            if (overtime) structure.overtime = { ...structure.overtime.toObject(), ...overtime };
            structure.updatedBy = req.user.id;

            await structure.save();

            logger.info(`Salary structure revised for ${user.employeeCode} by ${req.user.email}, effective ${newEffectiveFrom.toISOString()}`);

            return successResponse(res, structure, 'Salary structure revised successfully');
            
        } catch (error) {
            logger.error('Upsert salary structure error:', error);
            return errorResponse(res, error.message, 500);
        }
    };

    // @desc    Get salary revision history for an employee
    // @route   GET /api/payroll/structure/:userId/history
    // @access  Private (self) / Private/Admin (any)
    exports.getRevisionHistory = async (req, res) => {

        try {
            
            const { userId } = req.params;
            if (req.user.id !== userId && !SUPERADMIN_ROLES.includes(req.user.role)) {
                const targetUser = await User.findById(userId).select('company subCompany');
                if (!targetUser || !canAccessUser(req, targetUser)) {
                    return errorResponse(res, 'Not authorized', 403);
                }
            }

            const structure = await SalaryStructure.findOne({ user: userId })
                .populate('revisionHistory.revisedBy', 'firstName lastName');
            if (!structure) return errorResponse(res, 'Salary structure not configured for this employee', 404);

            const history = [
                ...structure.revisionHistory.toObject(),
                {
                    monthlyGrossSalary: structure.monthlyGrossSalary,
                    annualCTC: structure.annualCTC,
                    effectiveFrom: structure.effectiveFrom,
                    effectiveTo: null,
                    remarks: 'Current'
                }
            ].sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom));

            return successResponse(res, history, 'Salary revision history retrieved');
            
        } catch (error) {
            logger.error('Get revision history error:', error);
            return errorResponse(res, error.message, 500);
        }
    };
