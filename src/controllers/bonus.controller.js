const Bonus = require('../models/Bonus');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Create a bonus for an employee
// @route   POST /api/payroll/bonuses
// @access  Private/Admin
exports.createBonus = async (req, res) => {
    try {
        const { userId, bonusType, amount, month, year, description } = req.body;
        if (!userId || !bonusType || !amount || !month || !year) {
            return errorResponse(res, 'userId, bonusType, amount, month and year are required', 400);
        }

        const bonus = await Bonus.create({
            user: userId, bonusType, amount, month, year, description,
            createdBy: req.user.id
        });

        logger.info(`Bonus created for user ${userId} - ${bonusType} (${month}/${year}) by ${req.user.email}`);
        return successResponse(res, bonus, 'Bonus created successfully', 201);
    } catch (error) {
        logger.error('Create bonus error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get all bonuses
// @route   GET /api/payroll/bonuses
// @access  Private/Admin
exports.getBonuses = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, month, year, status } = req.query;
        const query = {};
        if (userId) query.user = userId;
        if (month) query.month = parseInt(month);
        if (year) query.year = parseInt(year);
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Bonus.countDocuments(query);
        const bonuses = await Bonus.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, bonuses, {
            page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get bonuses error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get my bonuses
// @route   GET /api/payroll/bonuses/my
// @access  Private
exports.getMyBonuses = async (req, res) => {
    try {
        const bonuses = await Bonus.find({ user: req.user.id }).sort({ year: -1, month: -1 });
        return successResponse(res, bonuses, 'Bonuses retrieved');
    } catch (error) {
        logger.error('Get my bonuses error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve a bonus
// @route   PUT /api/payroll/bonuses/:id/approve
// @access  Private/Admin
exports.approveBonus = async (req, res) => {
    try {
        const bonus = await Bonus.findByIdAndUpdate(
            req.params.id,
            { status: 'approved', approvedBy: req.user.id, approvedAt: new Date() },
            { new: true }
        );
        if (!bonus) return errorResponse(res, 'Bonus not found', 404);
        return successResponse(res, bonus, 'Bonus approved');
    } catch (error) {
        logger.error('Approve bonus error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Reject a bonus
// @route   PUT /api/payroll/bonuses/:id/reject
// @access  Private/Admin
exports.rejectBonus = async (req, res) => {
    try {
        const { reason } = req.body;
        const bonus = await Bonus.findByIdAndUpdate(
            req.params.id,
            { status: 'rejected', approvedBy: req.user.id, approvedAt: new Date(), rejectionReason: reason },
            { new: true }
        );
        if (!bonus) return errorResponse(res, 'Bonus not found', 404);
        return successResponse(res, bonus, 'Bonus rejected');
    } catch (error) {
        logger.error('Reject bonus error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Delete a bonus (only if not yet applied to a salary slip)
// @route   DELETE /api/payroll/bonuses/:id
// @access  Private/Admin
exports.deleteBonus = async (req, res) => {
    try {
        const bonus = await Bonus.findById(req.params.id);
        if (!bonus) return errorResponse(res, 'Bonus not found', 404);
        if (bonus.isApplied) return errorResponse(res, 'Cannot delete a bonus that has already been applied to a salary slip', 409);

        await bonus.deleteOne();
        return successResponse(res, null, 'Bonus deleted');
    } catch (error) {
        logger.error('Delete bonus error:', error);
        return errorResponse(res, error.message, 500);
    }
};
