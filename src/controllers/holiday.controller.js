const moment = require('moment-timezone');
const Holiday = require('../models/Holiday');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Get all holidays
// @route   GET /api/holidays
// @access  Private
exports.getHolidays = async (req, res) => {
    try {
        const { year, type, isActive } = req.query;
        const query = {};

        if (year) {
            const startOfYear = moment(`${year}-01-01`).startOf('year').toDate();
            const endOfYear = moment(`${year}-12-31`).endOf('year').toDate();
            query.date = { $gte: startOfYear, $lte: endOfYear };
        }
        if (type) query.type = type;
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const holidays = await Holiday.find(query).sort({ date: 1 });
        return successResponse(res, holidays, 'Holidays retrieved successfully');
    } catch (error) {
        logger.error('Get holidays error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get holiday by ID
// @route   GET /api/holidays/:id
// @access  Private
exports.getHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.findById(req.params.id);
        if (!holiday) return errorResponse(res, 'Holiday not found', 404);
        return successResponse(res, holiday, 'Holiday retrieved successfully');
    } catch (error) {
        logger.error('Get holiday error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create holiday
// @route   POST /api/holidays
// @access  Private/Admin
exports.createHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.create({
            ...req.body,
            createdBy: req.user.id
        });
        logger.info(`Holiday created: ${holiday.name} by ${req.user.id}`);
        return successResponse(res, holiday, 'Holiday created successfully', 201);
    } catch (error) {
        logger.error('Create holiday error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update holiday
// @route   PUT /api/holidays/:id
// @access  Private/Admin
exports.updateHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!holiday) return errorResponse(res, 'Holiday not found', 404);
        logger.info(`Holiday updated: ${holiday.name} by ${req.user.id}`);
        return successResponse(res, holiday, 'Holiday updated successfully');
    } catch (error) {
        logger.error('Update holiday error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Delete holiday
// @route   DELETE /api/holidays/:id
// @access  Private/Admin
exports.deleteHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.findByIdAndDelete(req.params.id);
        if (!holiday) return errorResponse(res, 'Holiday not found', 404);
        logger.info(`Holiday deleted: ${holiday.name} by ${req.user.id}`);
        return successResponse(res, null, 'Holiday deleted successfully');
    } catch (error) {
        logger.error('Delete holiday error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Bulk create holidays
// @route   POST /api/holidays/bulk
// @access  Private/Admin
exports.bulkCreateHolidays = async (req, res) => {
    try {
        const { holidays } = req.body;
        const createdHolidays = [];
        const errors = [];

        for (const holidayData of holidays) {
            try {
                const holiday = await Holiday.create({
                    ...holidayData,
                    createdBy: req.user.id
                });
                createdHolidays.push(holiday);
            } catch (err) {
                errors.push({ data: holidayData, error: err.message });
            }
        }

        logger.info(`Bulk holidays created: ${createdHolidays.length}, errors: ${errors.length}`);
        return successResponse(res, { created: createdHolidays, errors }, 'Bulk holiday creation completed');
    } catch (error) {
        logger.error('Bulk create holidays error:', error);
        return errorResponse(res, error.message, 500);
    }
};
