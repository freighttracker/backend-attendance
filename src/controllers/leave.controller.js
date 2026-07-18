const moment = require('moment-timezone');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const LeaveType = require('../models/LeaveType');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const WeekendConfig = require('../models/WeekendConfig');
const Holiday = require('../models/Holiday');
const SandwichLeavePolicy = require('../models/SandwichLeavePolicy');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// Calculate working days between dates (excluding weekends and holidays)
const calculateWorkingDays = async (startDate, endDate) => {
    let count = 0;
    const current = moment(startDate);
    const end = moment(endDate);

    const weekendConfigs = await WeekendConfig.find({ isWeekend: true });
    const weekendDays = weekendConfigs.map(w => w.dayOfWeek);

    while (current <= end) {
        const dayName = current.format('dddd').toLowerCase();
        if (!weekendDays.includes(dayName)) {
            const isHol = await Holiday.findOne({
                date: {
                    $gte: current.startOf('day').toDate(),
                    $lte: current.endOf('day').toDate()
                },
                isActive: true
            });
            if (!isHol) count++;
        }
        current.add(1, 'day');
    }
    return count;
};

// Check sandwich leave
const checkSandwichLeave = async (startDate, endDate, leaveTypeCode) => {
    const policy = await SandwichLeavePolicy.findOne();
    if (!policy || !policy.isEnabled) return { isSandwich: false, extraDays: 0 };

    if (!policy.appliesToLeaveTypes.includes(leaveTypeCode)) {
        return { isSandwich: false, extraDays: 0 };
    }

    const start = moment(startDate);
    const end = moment(endDate);
    const daysDiff = end.diff(start, 'days') + 1;

    if (daysDiff < policy.minLeaveDays) {
        return { isSandwich: false, extraDays: 0 };
    }

    // Check if leave is taken before and after weekend/holiday
    const dayBefore = start.clone().subtract(1, 'day');
    const dayAfter = end.clone().add(1, 'day');

    const weekendConfigs = await WeekendConfig.find({ isWeekend: true });
    const weekendDays = weekendConfigs.map(w => w.dayOfWeek);

    let sandwichDays = 0;

    // Check days between start and previous working day
    let checkDay = dayBefore.clone();
    while (weekendDays.includes(checkDay.format('dddd').toLowerCase())) {
        sandwichDays++;
        checkDay.subtract(1, 'day');
    }

    // Check days between end and next working day
    checkDay = dayAfter.clone();
    while (weekendDays.includes(checkDay.format('dddd').toLowerCase())) {
        sandwichDays++;
        checkDay.add(1, 'day');
    }

    return { isSandwich: sandwichDays > 0, extraDays: sandwichDays };
};

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
        let workingDays = await calculateWorkingDays(startDate, endDate);

        // Check sandwich leave
        const sandwichCheck = await checkSandwichLeave(startDate, endDate, leaveType.code);
        if (sandwichCheck.isSandwich) {
            workingDays += sandwichCheck.extraDays;
        }

        // Check leave balance for paid leaves
        if (leaveType.isPaid && leaveType.defaultDaysPerYear > 0) {
            const currentYear = new Date().getFullYear();
            const balance = await LeaveBalance.findOne({
                user: userId,
                leaveType: leaveTypeId,
                year: currentYear
            });

            if (!balance) {
                return errorResponse(res, 'Leave balance not found', 404);
            }

            const availableBalance = balance.totalDays + balance.carryForwardDays - balance.usedDays - balance.pendingDays;
            if (availableBalance < workingDays) {
                return errorResponse(res, `Insufficient leave balance. Available: ${availableBalance}, Required: ${workingDays}`, 400);
            }
        }

        const leaveRequest = await LeaveRequest.create({
            user: userId,
            leaveType: leaveTypeId,
            startDate,
            endDate,
            totalDays: workingDays,
            reason,
            attachmentUrl,
            isSandwichLeave: sandwichCheck.isSandwich,
            sandwichLeaveDays: sandwichCheck.extraDays
        });

        // Update pending days in balance
        if (leaveType.isPaid && leaveType.defaultDaysPerYear > 0) {
            const currentYear = new Date().getFullYear();
            await LeaveBalance.findOneAndUpdate(
                { user: userId, leaveType: leaveTypeId, year: currentYear },
                { $inc: { pendingDays: workingDays } }
            );
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
        const { page = 1, limit = 10, status } = req.query;
        const userId = req.user.id;

        const query = { user: userId };
        if (status) query.status = status;

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
        const { page = 1, limit = 20, status, userId, startDate, endDate } = req.query;

        const query = {};
        if (status) query.status = status;
        if (userId) query.user = userId;
        if (startDate && endDate) {
            query.$or = [
                { startDate: { $gte: new Date(startDate), $lte: new Date(endDate) } },
                { endDate: { $gte: new Date(startDate), $lte: new Date(endDate) } }
            ];
        }

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
        const { status, rejectionReason } = req.body;
        const leaveId = req.params.id;

        const leaveRequest = await LeaveRequest.findById(leaveId).populate('leaveType');
        if (!leaveRequest) {
            return errorResponse(res, 'Leave request not found', 404);
        }

        if (leaveRequest.status !== 'pending') {
            return errorResponse(res, 'Leave request already processed', 400);
        }

        leaveRequest.status = status;
        leaveRequest.approvedBy = req.user.id;
        leaveRequest.approvedAt = new Date();

        if (status === 'rejected') {
            leaveRequest.rejectionReason = rejectionReason;
        }

        await leaveRequest.save();

        const currentYear = new Date().getFullYear();
        const balance = await LeaveBalance.findOne({
            user: leaveRequest.user,
            leaveType: leaveRequest.leaveType,
            year: currentYear
        });

        if (status === 'approved') {
            // Update used days and mark attendance as on_leave
            if (balance) {
                balance.usedDays += leaveRequest.totalDays;
                balance.pendingDays -= leaveRequest.totalDays;
                await balance.save();
            }

            // Create attendance records for leave period
            const start = moment(leaveRequest.startDate);
            const end = moment(leaveRequest.endDate);
            const current = start.clone();

            while (current <= end) {
                await AttendanceRecord.findOneAndUpdate(
                    { user: leaveRequest.user, date: current.startOf('day').toDate() },
                    {
                        user: leaveRequest.user,
                        date: current.startOf('day').toDate(),
                        status: 'on_leave',
                        notes: `Leave: ${leaveRequest.leaveType.name}`
                    },
                    { upsert: true, new: true }
                );
                current.add(1, 'day');
            }
        } else if (status === 'rejected') {
            // Revert pending days
            if (balance) {
                balance.pendingDays -= leaveRequest.totalDays;
                await balance.save();
            }
        }

        logger.info(`Leave ${status} by admin ${req.user.id}`);
        return successResponse(res, leaveRequest, `Leave ${status} successfully`);
    } catch (error) {
        logger.error('Update leave status error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Cancel leave request
// @route   PUT /api/leaves/:id/cancel
// @access  Private
exports.cancelLeave = async (req, res) => {
    try {
        const leaveId = req.params.id;
        const userId = req.user.id;

        const leaveRequest = await LeaveRequest.findOne({
            _id: leaveId,
            user: userId,
            status: 'pending'
        });

        if (!leaveRequest) {
            return errorResponse(res, 'Leave request not found or cannot be cancelled', 404);
        }

        leaveRequest.status = 'cancelled';
        await leaveRequest.save();

        // Revert pending days
        const currentYear = new Date().getFullYear();
        await LeaveBalance.findOneAndUpdate(
            { user: userId, leaveType: leaveRequest.leaveType, year: currentYear },
            { $inc: { pendingDays: -leaveRequest.totalDays } }
        );

        return successResponse(res, leaveRequest, 'Leave request cancelled');
    } catch (error) {
        logger.error('Cancel leave error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get leave balance
// @route   GET /api/leaves/balance
// @access  Private
exports.getLeaveBalance = async (req, res) => {
    try {
        const userId = req.user.id;
        const year = req.query.year || new Date().getFullYear();

        const balances = await LeaveBalance.find({ user: userId, year: parseInt(year) })
            .populate('leaveType', 'name code colorCode isPaid');

        return successResponse(res, balances, 'Leave balance retrieved');
    } catch (error) {
        logger.error('Get leave balance error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get leave types
// @route   GET /api/leaves/types
// @access  Private
exports.getLeaveTypes = async (req, res) => {
    try {
        const types = await LeaveType.find({ isActive: true });
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
