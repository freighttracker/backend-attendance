const SystemSetting = require('../models/SystemSetting');
const AttendanceRule = require('../models/AttendanceRule');
const SandwichLeavePolicy = require('../models/SandwichLeavePolicy');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Get all system settings
// @route   GET /api/settings
// @access  Private/Admin
exports.getSettings = async (req, res) => {
    try {
        const settings = await SystemSetting.find();
        return successResponse(res, settings, 'Settings retrieved');
    } catch (error) {
        logger.error('Get settings error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get setting by key
// @route   GET /api/settings/:key
// @access  Private
exports.getSettingByKey = async (req, res) => {
    try {
        const setting = await SystemSetting.findOne({ settingKey: req.params.key });
        if (!setting) return errorResponse(res, 'Setting not found', 404);
        return successResponse(res, setting, 'Setting retrieved');
    } catch (error) {
        logger.error('Get setting error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update setting
// @route   PUT /api/settings/:key
// @access  Private/Admin
exports.updateSetting = async (req, res) => {
    try {
        const { settingValue } = req.body;
        const setting = await SystemSetting.findOneAndUpdate(
            { settingKey: req.params.key },
            { settingValue },
            { new: true }
        );
        if (!setting) return errorResponse(res, 'Setting not found', 404);
        logger.info(`Setting updated: ${req.params.key}`);
        return successResponse(res, setting, 'Setting updated');
    } catch (error) {
        logger.error('Update setting error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create new setting
// @route   POST /api/settings
// @access  Private/Admin
exports.createSetting = async (req, res) => {
    try {
        const setting = await SystemSetting.create(req.body);
        return successResponse(res, setting, 'Setting created', 201);
    } catch (error) {
        logger.error('Create setting error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get attendance rules
// @route   GET /api/settings/attendance-rules
// @access  Private/Admin
exports.getAttendanceRules = async (req, res) => {
    try {
        const rules = await AttendanceRule.find();
        return successResponse(res, rules, 'Attendance rules retrieved');
    } catch (error) {
        logger.error('Get attendance rules error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create attendance rule
// @route   POST /api/settings/attendance-rules
// @access  Private/Admin
exports.createAttendanceRule = async (req, res) => {
    try {
        const rule = await AttendanceRule.create(req.body);
        return successResponse(res, rule, 'Attendance rule created', 201);
    } catch (error) {
        logger.error('Create attendance rule error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update attendance rule
// @route   PUT /api/settings/attendance-rules/:id
// @access  Private/Admin
exports.updateAttendanceRule = async (req, res) => {
    try {
        const rule = await AttendanceRule.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!rule) return errorResponse(res, 'Rule not found', 404);
        return successResponse(res, rule, 'Attendance rule updated');
    } catch (error) {
        logger.error('Update attendance rule error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Delete attendance rule
// @route   DELETE /api/settings/attendance-rules/:id
// @access  Private/Admin
exports.deleteAttendanceRule = async (req, res) => {
    try {
        const rule = await AttendanceRule.findByIdAndDelete(req.params.id);
        if (!rule) return errorResponse(res, 'Rule not found', 404);
        return successResponse(res, null, 'Attendance rule deleted');
    } catch (error) {
        logger.error('Delete attendance rule error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get sandwich leave policy
// @route   GET /api/settings/sandwich-policy
// @access  Private/Admin
exports.getSandwichPolicy = async (req, res) => {
    try {
        const policy = await SandwichLeavePolicy.findOne();
        return successResponse(res, policy, 'Sandwich policy retrieved');
    } catch (error) {
        logger.error('Get sandwich policy error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update sandwich leave policy
// @route   PUT /api/settings/sandwich-policy
// @access  Private/Admin
exports.updateSandwichPolicy = async (req, res) => {
    try {
        const policy = await SandwichLeavePolicy.findOneAndUpdate(
            {},
            req.body,
            { new: true, upsert: true }
        );
        return successResponse(res, policy, 'Sandwich policy updated');
    } catch (error) {
        logger.error('Update sandwich policy error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Enable/Disable system features
// @route   PUT /api/settings/features/:feature
// @access  Private/Admin
exports.toggleFeature = async (req, res) => {
    try {
        const { feature } = req.params;
        const { enabled } = req.body;

        const setting = await SystemSetting.findOneAndUpdate(
            { settingKey: feature },
            { settingValue: enabled.toString() },
            { new: true, upsert: true }
        );

        return successResponse(res, setting, `Feature ${feature} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
        logger.error('Toggle feature error:', error);
        return errorResponse(res, error.message, 500);
    }
};
