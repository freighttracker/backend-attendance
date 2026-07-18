const moment = require('moment-timezone');
const Reimbursement = require('../models/Reimbursement');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Submit a reimbursement request
// @route   POST /api/payroll/reimbursements
// @access  Private
exports.createReimbursement = async (req, res) => {
    try {
        const { category, amount, description, expenseDate, userId } = req.body;
        if (!category || !amount || !expenseDate) {
            return errorResponse(res, 'category, amount and expenseDate are required', 400);
        }

        // Admins may file a reimbursement on behalf of an employee; otherwise it's always self.
        const targetUser = (req.user.role === 'admin' && userId) ? userId : req.user.id;
        const date = moment(expenseDate);
        const billUrl = req.file ? `/uploads/documents/${req.file.filename}` : null;

        const reimbursement = await Reimbursement.create({
            user: targetUser,
            category,
            amount,
            description,
            expenseDate: date.toDate(),
            month: date.month() + 1,
            year: date.year(),
            billUrl
        });

        logger.info(`Reimbursement submitted by ${req.user.email} for ${category} - ${amount}`);
        return successResponse(res, reimbursement, 'Reimbursement submitted successfully', 201);
    } catch (error) {
        logger.error('Create reimbursement error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get all reimbursements
// @route   GET /api/payroll/reimbursements
// @access  Private/Admin
exports.getReimbursements = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, month, year, status, category } = req.query;
        const query = {};
        if (userId) query.user = userId;
        if (month) query.month = parseInt(month);
        if (year) query.year = parseInt(year);
        if (status) query.status = status;
        if (category) query.category = category;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Reimbursement.countDocuments(query);
        const reimbursements = await Reimbursement.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, reimbursements, {
            page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get reimbursements error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get my reimbursements
// @route   GET /api/payroll/reimbursements/my
// @access  Private
exports.getMyReimbursements = async (req, res) => {
    try {
        const reimbursements = await Reimbursement.find({ user: req.user.id }).sort({ createdAt: -1 });
        return successResponse(res, reimbursements, 'Reimbursements retrieved');
    } catch (error) {
        logger.error('Get my reimbursements error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve a reimbursement
// @route   PUT /api/payroll/reimbursements/:id/approve
// @access  Private/Admin
exports.approveReimbursement = async (req, res) => {
    try {
        const reimbursement = await Reimbursement.findByIdAndUpdate(
            req.params.id,
            { status: 'approved', approvedBy: req.user.id, approvedAt: new Date() },
            { new: true }
        );
        if (!reimbursement) return errorResponse(res, 'Reimbursement not found', 404);
        return successResponse(res, reimbursement, 'Reimbursement approved');
    } catch (error) {
        logger.error('Approve reimbursement error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Reject a reimbursement
// @route   PUT /api/payroll/reimbursements/:id/reject
// @access  Private/Admin
exports.rejectReimbursement = async (req, res) => {
    try {
        const { reason } = req.body;
        const reimbursement = await Reimbursement.findByIdAndUpdate(
            req.params.id,
            { status: 'rejected', approvedBy: req.user.id, approvedAt: new Date(), rejectionReason: reason },
            { new: true }
        );
        if (!reimbursement) return errorResponse(res, 'Reimbursement not found', 404);
        return successResponse(res, reimbursement, 'Reimbursement rejected');
    } catch (error) {
        logger.error('Reject reimbursement error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Delete a reimbursement (only if not yet applied to a salary slip)
// @route   DELETE /api/payroll/reimbursements/:id
// @access  Private/Admin
exports.deleteReimbursement = async (req, res) => {
    try {
        const reimbursement = await Reimbursement.findById(req.params.id);
        if (!reimbursement) return errorResponse(res, 'Reimbursement not found', 404);
        if (reimbursement.isApplied) return errorResponse(res, 'Cannot delete a reimbursement that has already been applied to a salary slip', 409);

        await reimbursement.deleteOne();
        return successResponse(res, null, 'Reimbursement deleted');
    } catch (error) {
        logger.error('Delete reimbursement error:', error);
        return errorResponse(res, error.message, 500);
    }
};
