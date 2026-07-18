const WeekendConfig = require('../models/WeekendConfig');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Get all weekend configurations
// @route   GET /api/weekends
// @access  Private
exports.getWeekendConfigs = async (req, res) => {
    try {
        const configs = await WeekendConfig.find().sort({ dayOfWeek: 1 });
        return successResponse(res, configs, 'Weekend configurations retrieved');
    } catch (error) {
        logger.error('Get weekend configs error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update weekend configuration
// @route   PUT /api/weekends/:id
// @access  Private/Admin
exports.updateWeekendConfig = async (req, res) => {
    try {
        const config = await WeekendConfig.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!config) return errorResponse(res, 'Weekend config not found', 404);
        logger.info(`Weekend config updated: ${config.dayOfWeek}`);
        return successResponse(res, config, 'Weekend configuration updated');
    } catch (error) {
        logger.error('Update weekend config error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update all weekend configs at once
// @route   PUT /api/weekends/bulk
// @access  Private/Admin
exports.bulkUpdateWeekendConfig = async (req, res) => {
    try {
        const { configs } = req.body;
        const updated = [];

        for (const config of configs) {
            
            const updatedConfig = await WeekendConfig.findOneAndUpdate(
                { dayOfWeek: config.dayOfWeek },
                config,
                { new: true, upsert: true }
            );
            updated.push(updatedConfig);
        }

        logger.info('Weekend configs bulk updated');
        return successResponse(res, updated, 'Weekend configurations updated');
    } catch (error) {
        logger.error('Bulk update weekend config error:', error);
        return errorResponse(res, error.message, 500);
    }
};
