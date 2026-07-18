const AdvanceSalary = require('../models/AdvanceSalary');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Request/create a salary advance
// @route   POST /api/payroll/advances
// @access  Private (self) / Private/Admin (on behalf of an employee)
exports.createAdvance = async (req, res) => {
    try {
        const { userId, amount, reason, deductionPerMonth, startMonth, startYear } = req.body;
        if (!amount || !deductionPerMonth || !startMonth || !startYear) {
            return errorResponse(res, 'amount, deductionPerMonth, startMonth and startYear are required', 400);
        }

        const targetUser = (req.user.role === 'admin' && userId) ? userId : req.user.id;

        const advance = await AdvanceSalary.create({
            user: targetUser,
            amount,
            reason,
            deductionPerMonth,
            startMonth,
            startYear,
            remainingBalance: amount,
            createdBy: req.user.id,
            status: req.user.role === 'admin' ? 'active' : 'pending',
            approvedBy: req.user.role === 'admin' ? req.user.id : undefined,
            approvedAt: req.user.role === 'admin' ? new Date() : undefined
        });

        logger.info(`Advance salary created for user ${targetUser} - amount ${amount} by ${req.user.email}`);
        return successResponse(res, advance, 'Advance salary request created successfully', 201);
    } catch (error) {
        logger.error('Create advance salary error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get all salary advances
// @route   GET /api/payroll/advances
// @access  Private/Admin
exports.getAdvances = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, status } = req.query;
        const query = {};
        if (userId) query.user = userId;
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await AdvanceSalary.countDocuments(query);
        const advances = await AdvanceSalary.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, advances, {
            page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get advances error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get my salary advances
// @route   GET /api/payroll/advances/my
// @access  Private
exports.getMyAdvances = async (req, res) => {
    try {
        const advances = await AdvanceSalary.find({ user: req.user.id }).sort({ createdAt: -1 });
        return successResponse(res, advances, 'Advances retrieved');
    } catch (error) {
        logger.error('Get my advances error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve a pending advance request
// @route   PUT /api/payroll/advances/:id/approve
// @access  Private/Admin
exports.approveAdvance = async (req, res) => {
    try {
        const advance = await AdvanceSalary.findById(req.params.id);
        if (!advance) return errorResponse(res, 'Advance not found', 404);
        if (advance.status !== 'pending') return errorResponse(res, 'Only pending advances can be approved', 400);

        advance.status = 'active';
        advance.approvedBy = req.user.id;
        advance.approvedAt = new Date();
        await advance.save();

        return successResponse(res, advance, 'Advance approved');
    } catch (error) {
        logger.error('Approve advance error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Reject a pending advance request
// @route   PUT /api/payroll/advances/:id/reject
// @access  Private/Admin
exports.rejectAdvance = async (req, res) => {
    try {
        const advance = await AdvanceSalary.findByIdAndUpdate(
            req.params.id,
            { status: 'rejected' },
            { new: true }
        );
        if (!advance) return errorResponse(res, 'Advance not found', 404);
        return successResponse(res, advance, 'Advance rejected');
    } catch (error) {
        logger.error('Reject advance error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Close an active advance
// @route   PUT /api/payroll/advances/:id/close
// @access  Private/Admin
exports.closeAdvance = async (req, res) => {
    try {
        const advance = await AdvanceSalary.findByIdAndUpdate(
            req.params.id,
            { status: 'closed' },
            { new: true }
        );
        if (!advance) return errorResponse(res, 'Advance not found', 404);
        return successResponse(res, advance, 'Advance closed');
    } catch (error) {
        logger.error('Close advance error:', error);
        return errorResponse(res, error.message, 500);
    }
};
