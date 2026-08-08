const moment = require('moment-timezone');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const LeaveType = require('../models/LeaveType');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');
const leaveService = require('../services/leave.service');

// @desc    Apply for leave
// @route   POST /api/leaves/apply
// @access  Private
exports.applyLeave = async (req, res) => {
    try {
        const { leaveTypeId, startDate, endDate, reason, attachmentUrl } = req.body;
        const userId = req.user.id;

        const leaveType = await LeaveType.findById(leaveTypeId);
        if (!leaveType || !leaveType.isActive) {
            return errorResponse(res, 'Leave type not found or inactive', 404);
        }

        // Validate dates
        const start = moment(startDate);
        const end = moment(endDate);
        const today = moment();

        if (start.isBefore(today, 'day')) {
            return errorResponse(res, 'Cannot apply leave for past dates', 400);
        }

        if (end.isBefore(start)) {
            return errorResponse(res, 'End date must be after start date', 400);
        }

        const daysDiff = end.diff(start, 'days') + 1;
        if (daysDiff > leaveType.maxDaysAtOnce) {
            return errorResponse(res, `Maximum ${leaveType.maxDaysAtOnce} days allowed at once`, 400);
        }

        // Check minimum days before apply
        if (leaveType.minDaysBeforeApply > 0) {
            const minApplyDate = today.clone().add(leaveType.minDaysBeforeApply, 'days');
            if (start.isBefore(minApplyDate, 'day')) {
                return errorResponse(res, `Must apply at least ${leaveType.minDaysBeforeApply} days in advance`, 400);
            }
        }

        // Calculate working days
        let workingDays = await leaveService.calculateWorkingDays(startDate, endDate);

        // Check sandwich leave
        const sandwichCheck = await leaveService.checkSandwichLeave(startDate, endDate, leaveType.code);
        if (sandwichCheck.isSandwich) {
            workingDays += sandwichCheck.extraDays;
        }

        // Check leave balance (Leave Without Pay is exempt and always allowed).
        // Keyed by the leave's own start-date year (not today's year) so it
        // stays the same balance document that approve/reject/cancel/edit
        // operate on later - matters when applying near a year boundary.
        const leaveYear = start.year();
        const balance = await leaveService.getOrCreateLeaveBalance(userId, leaveType, leaveYear);
        if (!leaveType.isUnlimited) {
            const check = leaveService.checkBalanceAvailability(leaveType, balance, workingDays);
            if (!check.ok) {
                return errorResponse(res, `Insufficient leave balance. Available: ${check.available}, Required: ${workingDays}`, 400);
            }
        }

        // Medical certificate (or any other supporting document) uploaded via multer
        const uploadedAttachmentUrl = req.file ? `/uploads/leave-attachments/${req.file.filename}` : (attachmentUrl || null);

        const leaveRequest = await LeaveRequest.create({
            user: userId,
            leaveType: leaveTypeId,
            startDate,
            endDate,
            totalDays: workingDays,
            reason,
            attachmentUrl: uploadedAttachmentUrl,
            isSandwichLeave: sandwichCheck.isSandwich,
            sandwichLeaveDays: sandwichCheck.extraDays,
            // Every leave request starts unpaid regardless of the leave type's
            // own default - the admin decides paid/unpaid at approval time.
            paidStatus: 'unpaid'
        });

        await leaveService.incrementPending(userId, leaveTypeId, leaveYear, workingDays);

        // Notify admins so they can review the request
        const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
        if (admins.length > 0) {
            const employee = await User.findById(userId).select('firstName lastName');
            await Notification.insertMany(admins.map((admin) => ({
                user: admin._id,
                title: 'New Leave Request',
                message: `${employee.firstName} ${employee.lastName} applied for ${workingDays} day(s) of ${leaveType.name}`,
                type: 'info',
                actionUrl: '/admin?tab=leave'
            })));
        }

        logger.info(`Leave applied by user ${userId} for ${workingDays} days`);
        return successResponse(res, leaveRequest, 'Leave application submitted successfully', 201);
    } catch (error) {
        logger.error('Apply leave error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get my leave requests
// @route   GET /api/leaves/my-leaves
// @access  Private
exports.getMyLeaves = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, leaveTypeId, startDate, endDate } = req.query;
        const userId = req.user.id;

        const query = { user: userId };
        if (status) query.status = status;
        if (leaveTypeId) query.leaveType = leaveTypeId;
        if (startDate && endDate) {
            query.$or = [
                { startDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
                { endDate: { $gte: new Date(startDate), $lte: new Date(endDate) } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await LeaveRequest.countDocuments(query);

        const leaves = await LeaveRequest.find(query)
            .populate('leaveType', 'name code colorCode')
            .populate('approvedBy', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, leaves, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get my leaves error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get all leave requests (Admin)
// @route   GET /api/leaves/all
// @access  Private/Admin
exports.getAllLeaves = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, userId, leaveTypeId, department, search, startDate, endDate } = req.query;

        const query = {};
        if (status) query.status = status;
        if (leaveTypeId) query.leaveType = leaveTypeId;
        if (startDate && endDate) {
            query.$or = [
                { startDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
                { endDate: { $gte: new Date(startDate), $lte: new Date(endDate) } }
            ];
        }

        // department/search both resolve to a user-id filter, so merge them
        // with any explicit userId already given
        let userIdFilter = null;
        if (userId) {
            userIdFilter = [userId];
        }
        if (department) {
            const users = await User.find({ department }).select('_id');
            const ids = users.map((u) => u._id.toString());
            userIdFilter = userIdFilter ? userIdFilter.filter((id) => ids.includes(id.toString())) : ids;
        }
        if (search) {
            const rx = new RegExp(search, 'i');
            const users = await User.find({
                $or: [{ firstName: rx }, { lastName: rx }, { employeeCode: rx }, { email: rx }]
            }).select('_id');
            const ids = users.map((u) => u._id.toString());
            userIdFilter = userIdFilter ? userIdFilter.filter((id) => ids.includes(id.toString())) : ids;
        }
        if (userIdFilter) query.user = { $in: userIdFilter };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await LeaveRequest.countDocuments(query);

        const leaves = await LeaveRequest.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .populate('leaveType', 'name code colorCode')
            .populate('approvedBy', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, leaves, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get all leaves error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve/Reject leave
// @route   PUT /api/leaves/:id/status
// @access  Private/Admin
exports.updateLeaveStatus = async (req, res) => {
    try {
        const { status, rejectionReason, paidStatus, remarks } = req.body;
        const leaveId = req.params.id;

        const leaveRequest = await LeaveRequest.findById(leaveId).populate('leaveType');
        if (!leaveRequest) {
            return errorResponse(res, 'Leave request not found', 404);
        }

        if (leaveRequest.status !== 'pending') {
            return errorResponse(res, 'Leave request already processed', 400);
        }

        if (status === 'approved' && !['paid', 'unpaid'].includes(paidStatus)) {
            return errorResponse(res, 'paidStatus (paid|unpaid) is required when approving a leave request', 400);
        }

        leaveRequest.status = status;
        leaveRequest.approvedBy = req.user.id;
        leaveRequest.approvedAt = new Date();
        if (remarks !== undefined) leaveRequest.remarks = remarks;

        let skippedLockedDates = [];

        if (status === 'approved') {
            // Admin's paid/unpaid decision overrides the leave type's own default
            leaveRequest.paidStatus = paidStatus;
            await leaveRequest.save();

            const currentYear = new Date(leaveRequest.startDate).getFullYear();
            await leaveService.movePendingToUsed(leaveRequest.user, leaveRequest.leaveType._id, currentYear, leaveRequest.totalDays);

            skippedLockedDates = await leaveService.syncAttendanceForLeaveRange(
                leaveRequest.user,
                leaveRequest.leaveType.name,
                leaveRequest.startDate,
                leaveRequest.endDate,
                'mark'
            );
        } else if (status === 'rejected') {
            leaveRequest.rejectionReason = rejectionReason;
            await leaveRequest.save();

            const currentYear = new Date(leaveRequest.startDate).getFullYear();
            await leaveService.revertPending(leaveRequest.user, leaveRequest.leaveType._id, currentYear, leaveRequest.totalDays);
        } else {
            await leaveRequest.save();
        }

        await Notification.create({
            user: leaveRequest.user,
            title: `Leave ${status === 'approved' ? 'Approved' : 'Rejected'}`,
            message: status === 'approved'
                ? `Your ${leaveRequest.leaveType.name} request has been approved as ${leaveRequest.paidStatus}.`
                : `Your ${leaveRequest.leaveType.name} request was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
            type: status === 'approved' ? 'success' : 'error',
            actionUrl: '/leave'
        });

        if (skippedLockedDates.length > 0) {
            logger.warn(`Leave approval for ${leaveId} skipped locked attendance dates: ${skippedLockedDates.join(', ')}`);
        }

        logger.info(`Leave ${status} by admin ${req.user.id}`);
        return successResponse(res, { ...leaveRequest.toObject(), skippedLockedDates }, `Leave ${status} successfully`);
    } catch (error) {
        logger.error('Update leave status error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Cancel leave request (employee: own pending; admin: any pending or approved)
// @route   PUT /api/leaves/:id/cancel
// @access  Private
exports.cancelLeave = async (req, res) => {
    try {
        const leaveId = req.params.id;
        const isAdmin = req.user.role === 'admin';
        const query = isAdmin ? { _id: leaveId } : { _id: leaveId, user: req.user.id };

        const leaveRequest = await LeaveRequest.findOne(query).populate('leaveType');
        if (!leaveRequest) {
            return errorResponse(res, 'Leave request not found', 404);
        }

        if (!['pending', 'approved'].includes(leaveRequest.status)) {
            return errorResponse(res, 'Only pending or approved leave requests can be cancelled', 400);
        }

        if (leaveRequest.status === 'approved' && !isAdmin) {
            return errorResponse(res, 'Only an admin can cancel an approved leave', 403);
        }

        const year = new Date(leaveRequest.startDate).getFullYear();

        if (leaveRequest.status === 'pending') {
            await leaveService.revertPending(leaveRequest.user, leaveRequest.leaveType._id, year, leaveRequest.totalDays);
        } else {
            await leaveService.revertUsed(leaveRequest.user, leaveRequest.leaveType._id, year, leaveRequest.totalDays);
            await leaveService.syncAttendanceForLeaveRange(
                leaveRequest.user,
                leaveRequest.leaveType.name,
                leaveRequest.startDate,
                leaveRequest.endDate,
                'unmark'
            );
        }

        leaveRequest.status = 'cancelled';
        await leaveRequest.save();

        if (isAdmin) {
            await Notification.create({
                user: leaveRequest.user,
                title: 'Leave Cancelled',
                message: `Your ${leaveRequest.leaveType.name} request was cancelled by an admin.`,
                type: 'warning',
                actionUrl: '/leave'
            });
        }

        return successResponse(res, leaveRequest, 'Leave request cancelled');
    } catch (error) {
        logger.error('Cancel leave error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get leave balance (admin may pass ?userId= to view another employee's balance)
// @route   GET /api/leaves/balance
// @access  Private
exports.getLeaveBalance = async (req, res) => {
    try {

        const year = req.query.year || new Date().getFullYear();
        const targetUserId = (req.user.role === 'admin' && req.query.userId) ? req.query.userId : req.user.id;
        
        const balances = await LeaveBalance.find({ user: targetUserId, year: parseInt(year) })
            .populate('leaveType', 'name code colorCode isPaid isUnlimited');

        return successResponse(res, balances, 'Leave balance retrieved');
    } catch (error) {
        logger.error('Get leave balance error:', error);
        return errorResponse(res, error.message, 500);
    }

};

// @desc    Admin create/adjust an employee's leave balance
// @route   POST /api/leaves/balances
// @access  Private/Admin
exports.adjustLeaveBalance = async (req, res) => {
    try {

        const { userId, leaveTypeId, year, totalDays, carryForwardDays } = req.body;

        const update = {};
        if (totalDays !== undefined) update.totalDays = totalDays;
        if (carryForwardDays !== undefined) update.carryForwardDays = carryForwardDays;

        const balance = await LeaveBalance.findOneAndUpdate(
            { user: userId, leaveType: leaveTypeId, year },
            { $set: update },
            { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
        );

        return successResponse(res, balance, 'Leave balance updated');
        
    } catch (error) {
        logger.error('Adjust leave balance error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Admin edit a pending or approved leave request (type/dates/remarks)
// @route   PUT /api/leaves/:id
// @access  Private/Admin
exports.updateLeaveRequest = async (req, res) => {
    try {
        const { leaveTypeId, startDate, endDate, remarks } = req.body;

        const leaveRequest = await LeaveRequest.findById(req.params.id).populate('leaveType');
        if (!leaveRequest) return errorResponse(res, 'Leave request not found', 404);
        if (!['pending', 'approved'].includes(leaveRequest.status)) {
            return errorResponse(res, 'Only pending or approved leave requests can be edited', 400);
        }

        const oldDays = leaveRequest.totalDays;
        const oldLeaveTypeId = leaveRequest.leaveType._id;
        const oldYear = new Date(leaveRequest.startDate).getFullYear();

        let newLeaveType = leaveRequest.leaveType;
        if (leaveTypeId && String(leaveTypeId) !== String(oldLeaveTypeId)) {
            newLeaveType = await LeaveType.findById(leaveTypeId);
            if (!newLeaveType || !newLeaveType.isActive) {
                return errorResponse(res, 'Leave type not found or inactive', 404);
            }
        }

        const newStart = startDate || leaveRequest.startDate;
        const newEnd = endDate || leaveRequest.endDate;
        const newDays = await leaveService.calculateWorkingDays(newStart, newEnd);
        const newYear = new Date(newStart).getFullYear();
        const datesChanged = String(newStart) !== String(leaveRequest.startDate) || String(newEnd) !== String(leaveRequest.endDate);

        if (leaveRequest.status === 'pending') {
            await leaveService.revertPending(leaveRequest.user, oldLeaveTypeId, oldYear, oldDays);
            if (!newLeaveType.isUnlimited) {
                const balance = await leaveService.getOrCreateLeaveBalance(leaveRequest.user, newLeaveType, newYear);
                const check = leaveService.checkBalanceAvailability(newLeaveType, balance, newDays);
                if (!check.ok) {
                    return errorResponse(res, `Insufficient leave balance. Available: ${check.available}`, 400);
                }
            }
            await leaveService.incrementPending(leaveRequest.user, newLeaveType._id, newYear, newDays);
        } else {
            // approved
            await leaveService.revertUsed(leaveRequest.user, oldLeaveTypeId, oldYear, oldDays);
            await LeaveBalance.findOneAndUpdate(
                { user: leaveRequest.user, leaveType: newLeaveType._id, year: newYear },
                { $inc: { usedDays: newDays } },
                { upsert: true, setDefaultsOnInsert: true }
            );
            if (datesChanged || String(newLeaveType._id) !== String(oldLeaveTypeId)) {
                await leaveService.syncAttendanceForLeaveRange(
                    leaveRequest.user, leaveRequest.leaveType.name, leaveRequest.startDate, leaveRequest.endDate, 'unmark'
                );
                await leaveService.syncAttendanceForLeaveRange(
                    leaveRequest.user, newLeaveType.name, newStart, newEnd, 'mark'
                );
            }
        }

        leaveRequest.leaveType = newLeaveType._id;
        leaveRequest.startDate = newStart;
        leaveRequest.endDate = newEnd;
        leaveRequest.totalDays = newDays;
        if (remarks !== undefined) leaveRequest.remarks = remarks;
        leaveRequest.editedBy = req.user.id;
        leaveRequest.editedAt = new Date();
        await leaveRequest.save();

        logger.info(`Leave request ${req.params.id} edited by admin ${req.user.id}`);
        return successResponse(res, leaveRequest, 'Leave request updated');
    } catch (error) {
        logger.error('Update leave request error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get leave types
// @route   GET /api/leaves/types
// @access  Private
exports.getLeaveTypes = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true' && req.user.role === 'admin';
        const filter = includeInactive ? {} : { isActive: true };
        const types = await LeaveType.find(filter).sort({ name: 1 });
        return successResponse(res, types, 'Leave types retrieved');
    } catch (error) {
        logger.error('Get leave types error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create leave type (Admin)
// @route   POST /api/leaves/types
// @access  Private/Admin
exports.createLeaveType = async (req, res) => {
    try {
        const leaveType = await LeaveType.create(req.body);
        return successResponse(res, leaveType, 'Leave type created', 201);
    } catch (error) {
        logger.error('Create leave type error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update leave type (Admin)
// @route   PUT /api/leaves/types/:id
// @access  Private/Admin
exports.updateLeaveType = async (req, res) => {
    try {
        const leaveType = await LeaveType.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!leaveType) return errorResponse(res, 'Leave type not found', 404);
        return successResponse(res, leaveType, 'Leave type updated');
    } catch (error) {
        logger.error('Update leave type error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Deactivate leave type (Admin) - soft delete, avoids orphaning
//          historical LeaveRequest/LeaveBalance references
// @route   DELETE /api/leaves/types/:id
// @access  Private/Admin
exports.deleteLeaveType = async (req, res) => {
    try {
        const leaveType = await LeaveType.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );
        if (!leaveType) return errorResponse(res, 'Leave type not found', 404);
        return successResponse(res, leaveType, 'Leave type deactivated');
    } catch (error) {
        logger.error('Delete leave type error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Leave dashboard stats (KPI tiles + pie chart breakdowns)
// @route   GET /api/leaves/stats
// @access  Private/Admin
exports.getLeaveStats = async (req, res) => {
    try {
        const { month, year, department } = req.query;
        const stats = await leaveService.getLeaveDashboardStats({
            month: month ? parseInt(month) : undefined,
            year: year ? parseInt(year) : undefined,
            department
        });
        return successResponse(res, stats || { byStatus: [], byType: [], byDepartment: [], byPaidStatus: [] }, 'Leave stats retrieved');
    } catch (error) {
        logger.error('Get leave stats error:', error);
        return errorResponse(res, error.message, 500);
    }
};
