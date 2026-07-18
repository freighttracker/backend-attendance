const SalaryField = require('../models/SalaryField');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Get salary fields (active ones by default; admins can request all)
// @route   GET /api/salary-fields
// @access  Private
exports.getSalaryFields = async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const query = {};

        if (!(includeInactive === 'true' && req.user.role === 'admin')) {
            query.isActive = true;
        }

        const fields = await SalaryField.find(query).sort({ sortOrder: 1, createdAt: 1 });
        return successResponse(res, fields, 'Salary fields retrieved successfully');
    } catch (error) {
        logger.error('Get salary fields error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get single salary field
// @route   GET /api/salary-fields/:id
// @access  Private
exports.getSalaryField = async (req, res) => {
    try {
        const field = await SalaryField.findById(req.params.id);
        if (!field) return errorResponse(res, 'Salary field not found', 404);
        return successResponse(res, field, 'Salary field retrieved successfully');
    } catch (error) {
        logger.error('Get salary field error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create salary field
// @route   POST /api/salary-fields
// @access  Private/Admin
exports.createSalaryField = async (req, res) => {
    try {
        const field = await SalaryField.create({
            ...req.body,
            createdBy: req.user.id
        });
        logger.info(`Salary field created: ${field.code} by ${req.user.id}`);
        return successResponse(res, field, 'Salary field created successfully', 201);
    } catch (error) {
        if (error.code === 11000) {
            return errorResponse(res, 'A salary field with this code already exists', 409);
        }
        logger.error('Create salary field error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update salary field
// @route   PUT /api/salary-fields/:id
// @access  Private/Admin
exports.updateSalaryField = async (req, res) => {
    try {
        const field = await SalaryField.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!field) return errorResponse(res, 'Salary field not found', 404);
        logger.info(`Salary field updated: ${field.code} by ${req.user.id}`);
        return successResponse(res, field, 'Salary field updated successfully');
    } catch (error) {
        if (error.code === 11000) {
            return errorResponse(res, 'A salary field with this code already exists', 409);
        }
        logger.error('Update salary field error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Delete salary field
// @route   DELETE /api/salary-fields/:id
// @access  Private/Admin
exports.deleteSalaryField = async (req, res) => {
    try {
        const field = await SalaryField.findByIdAndDelete(req.params.id);
        if (!field) return errorResponse(res, 'Salary field not found', 404);
        logger.info(`Salary field deleted: ${field.code} by ${req.user.id}`);
        return successResponse(res, null, 'Salary field deleted successfully');
    } catch (error) {
        logger.error('Delete salary field error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Reorder salary fields
// @route   PUT /api/salary-fields/reorder
// @access  Private/Admin
exports.reorderSalaryFields = async (req, res) => {
    try {
        const { order } = req.body; // [{ id, sortOrder }]
        if (!Array.isArray(order)) {
            return errorResponse(res, 'order must be an array of { id, sortOrder }', 400);
        }

        await Promise.all(
            order.map(({ id, sortOrder }) => SalaryField.findByIdAndUpdate(id, { sortOrder }))
        );

        const fields = await SalaryField.find({}).sort({ sortOrder: 1, createdAt: 1 });
        return successResponse(res, fields, 'Salary fields reordered successfully');
    } catch (error) {
        logger.error('Reorder salary fields error:', error);
        return errorResponse(res, error.message, 500);
    }
};
