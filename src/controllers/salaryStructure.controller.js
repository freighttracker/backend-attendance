const moment = require('moment-timezone');
const SalaryStructure = require('../models/SalaryStructure');
const User = require('../models/User');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

    // @desc    Get an employee's current salary structure
    // @route   GET /api/payroll/structure/:userId
    // @access  Private (self) / Private/Admin (any)
    exports.getSalaryStructure = async (req, res) => {

        try {
            const { userId } = req.params;
            if (req.user.role !== 'admin' && req.user.id !== userId) {
                return errorResponse(res, 'Not authorized', 403);
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
    // @access  Private/Admin
    exports.listSalaryStructures = async (req, res) => {
        try {
            const { page = 1, limit = 20, department } = req.query;
            const userQuery = { isActive: true };
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

            let structure = await SalaryStructure.findOne({ user: userId });

            if (!structure) {

                if (monthlyGrossSalary === undefined || annualCTC === undefined) {
                    return errorResponse(res, 'monthlyGrossSalary and annualCTC are required to create a salary structure', 400);
                }

                structure = await SalaryStructure.create({
                    user: userId,
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

            const newEffectiveFrom = effectiveFrom ? new Date(effectiveFrom) : new Date();

            structure.revisionHistory.push({
                monthlyGrossSalary: structure.monthlyGrossSalary,
                annualCTC: structure.annualCTC,
                earnings: structure.earnings,
                deductions: structure.deductions,
                overtime: structure.overtime,
                effectiveFrom: structure.effectiveFrom,
                effectiveTo: moment(newEffectiveFrom).subtract(1, 'day').endOf('day').toDate(),
                revisedBy: req.user.id,
                remarks: remarks || 'Salary revised'
            });

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
            if (req.user.role !== 'admin' && req.user.id !== userId) {
                return errorResponse(res, 'Not authorized', 403);
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
