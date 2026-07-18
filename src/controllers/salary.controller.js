const fs = require('fs');
const path = require('path');
const SalarySlip = require('../models/SalarySlip');
const { runGenerateForUser } = require('./payroll.controller');
const { generateSalarySlipPDF } = require('../services/pdf.service');
const { sendSalarySlipEmail } = require('../services/email.service');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Get my salary slips
// @route   GET /api/salary/my-slips
// @access  Private
exports.getMySalarySlips = async (req, res) => {
    try {
        const { page = 1, limit = 10, year } = req.query;
        const userId = req.user.id;

        // Employees only ever see finalized slips - draft/generated numbers are still subject to change.
        const query = { user: userId, status: { $in: ['approved', 'published', 'paid'] } };
        if (year) query.year = parseInt(year);

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await SalarySlip.countDocuments(query);

        const slips = await SalarySlip.find(query)
            .sort({ year: -1, month: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, slips, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get my salary slips error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get all salary slips (Admin)
// @route   GET /api/salary/all
// @access  Private/Admin
exports.getAllSalarySlips = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, month, year, status } = req.query;

        const query = {};
        if (userId) query.user = userId;
        if (month) query.month = parseInt(month);
        if (year) query.year = parseInt(year);
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await SalarySlip.countDocuments(query);

        const slips = await SalarySlip.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .sort({ year: -1, month: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, slips, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get all salary slips error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get salary slip by ID
// @route   GET /api/salary/:id
// @access  Private
exports.getSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findById(req.params.id).populate('user', 'firstName lastName employeeCode department designation');
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);

        if (req.user.role !== 'admin' && slip.user._id.toString() !== req.user.id) {
            return errorResponse(res, 'Not authorized', 403);
        }

        return successResponse(res, slip, 'Salary slip retrieved');
    } catch (error) {
        logger.error('Get salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Regenerate a single salary slip (recomputes attendance/leave/bonus/deductions from scratch)
// @route   POST /api/salary/:id/regenerate
// @access  Private/Admin
exports.regenerateSalarySlip = async (req, res) => {
    try {
        const existing = await SalarySlip.findById(req.params.id);
        if (!existing) return errorResponse(res, 'Salary slip not found', 404);

        const slip = await runGenerateForUser(existing.user, existing.month, existing.year, req.user.id);

        logger.info(`Salary slip regenerated: ${slip._id} by ${req.user.email}`);
        return successResponse(res, slip, 'Salary slip regenerated successfully');
    } catch (error) {
        logger.error('Regenerate salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve a salary slip
// @route   PUT /api/salary/:id/approve
// @access  Private/Admin
exports.approveSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findById(req.params.id);
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);
        if (slip.status !== 'generated') return errorResponse(res, 'Only generated salary slips can be approved', 400);

        slip.status = 'approved';
        slip.approvedBy = req.user.id;
        slip.approvedAt = new Date();
        await slip.save();

        logger.info(`Salary slip approved: ${slip._id} by ${req.user.email}`);
        return successResponse(res, slip, 'Salary slip approved');
    } catch (error) {
        logger.error('Approve salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Reject a salary slip
// @route   PUT /api/salary/:id/reject
// @access  Private/Admin
exports.rejectSalarySlip = async (req, res) => {
    try {
        const { reason } = req.body;
        const slip = await SalarySlip.findById(req.params.id);
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);
        if (slip.isLocked) return errorResponse(res, 'Cannot reject a locked salary slip', 400);

        slip.status = 'rejected';
        slip.rejectedBy = req.user.id;
        slip.rejectedAt = new Date();
        slip.rejectionReason = reason;
        await slip.save();

        logger.info(`Salary slip rejected: ${slip._id} by ${req.user.email}`);
        return successResponse(res, slip, 'Salary slip rejected');
    } catch (error) {
        logger.error('Reject salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Publish a salary slip - makes it visible to the employee and locks it
// @route   PUT /api/salary/:id/publish
// @access  Private/Admin
exports.publishSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findById(req.params.id);
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);
        if (slip.status !== 'approved') return errorResponse(res, 'Salary slip must be approved before it can be published', 400);

        slip.status = 'published';
        slip.publishedBy = req.user.id;
        slip.publishedAt = new Date();
        slip.isLocked = true;
        await slip.save();

        logger.info(`Salary slip published: ${slip._id} by ${req.user.email}`);
        return successResponse(res, slip, 'Salary slip published');
    } catch (error) {
        logger.error('Publish salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Lock a salary slip to prevent further edits/regeneration
// @route   PUT /api/salary/:id/lock
// @access  Private/Admin
exports.lockSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findByIdAndUpdate(
            req.params.id,
            { isLocked: true, lockedBy: req.user.id, lockedAt: new Date() },
            { new: true }
        );
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);
        return successResponse(res, slip, 'Salary slip locked');
    } catch (error) {
        logger.error('Lock salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Unlock a salary slip
// @route   PUT /api/salary/:id/unlock
// @access  Private/Admin
exports.unlockSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findById(req.params.id);
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);
        if (['published', 'paid'].includes(slip.status)) {
            return errorResponse(res, 'Published/paid salary slips cannot be unlocked', 400);
        }

        slip.isLocked = false;
        slip.lockedBy = null;
        slip.lockedAt = null;
        await slip.save();

        return successResponse(res, slip, 'Salary slip unlocked');
    } catch (error) {
        logger.error('Unlock salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Mark salary as paid
// @route   PUT /api/salary/:id/pay
// @access  Private/Admin
exports.markAsPaid = async (req, res) => {
    try {
        const { paymentMethod, transactionId } = req.body;
        const slip = await SalarySlip.findById(req.params.id);
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);
        if (slip.status !== 'published') return errorResponse(res, 'Only published salary slips can be marked as paid', 400);

        slip.status = 'paid';
        slip.paidAt = new Date();
        slip.paymentMethod = paymentMethod;
        slip.transactionId = transactionId;
        await slip.save();

        logger.info(`Salary marked as paid: ${slip._id} by ${req.user.email}`);
        return successResponse(res, slip, 'Salary marked as paid');
    } catch (error) {
        logger.error('Mark as paid error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Download the salary slip PDF
// @route   GET /api/salary/:id/download
// @access  Private
exports.downloadSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findById(req.params.id);
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);
        if (req.user.role !== 'admin' && slip.user.toString() !== req.user.id) {
            return errorResponse(res, 'Not authorized', 403);
        }

        let pdfPath = slip.pdfUrl ? path.join(__dirname, '../..', slip.pdfUrl) : null;
        if (!pdfPath || !fs.existsSync(pdfPath)) {
            const pdfUrl = await generateSalarySlipPDF(slip);
            slip.pdfUrl = pdfUrl;
            await slip.save();
            pdfPath = path.join(__dirname, '../..', pdfUrl);
        }

        return res.download(pdfPath, `Salary-Slip-${slip.employeeSnapshot.employeeCode}-${slip.month}-${slip.year}.pdf`);
    } catch (error) {
        logger.error('Download salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Email the salary slip PDF to the employee
// @route   POST /api/salary/:id/email
// @access  Private/Admin
exports.emailSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findById(req.params.id);
        if (!slip) return errorResponse(res, 'Salary slip not found', 404);

        if (!slip.pdfUrl || !fs.existsSync(path.join(__dirname, '../..', slip.pdfUrl))) {
            const pdfUrl = await generateSalarySlipPDF(slip);
            slip.pdfUrl = pdfUrl;
            await slip.save();
        }

        await sendSalarySlipEmail(slip);
        slip.emailSentAt = new Date();
        await slip.save();

        return successResponse(res, slip, 'Salary slip emailed successfully');
    } catch (error) {
        logger.error('Email salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};
