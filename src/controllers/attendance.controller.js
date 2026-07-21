const moment = require('moment-timezone');
const AttendanceRecord = require('../models/AttendanceRecord');
const User = require('../models/User');
const AttendanceRule = require('../models/AttendanceRule');
const EmployeeRule = require('../models/EmployeeRule');
const WeekendConfig = require('../models/WeekendConfig');
const Holiday = require('../models/Holiday');
const AttendanceCorrectionRequest = require('../models/AttendanceCorrectionRequest');
const Notification = require('../models/Notification');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// Get user's attendance rule
const getUserRule = async (userId) => {
    const employeeRule = await EmployeeRule.findOne({
        user: userId,
        effectiveFrom: { $lte: new Date() },
        $or: [{ effectiveTo: { $gte: new Date() } }, { effectiveTo: null }]
    }).populate('rule');

    if (employeeRule) return employeeRule.rule;

    return await AttendanceRule.findOne({ isDefault: true, isActive: true });
};

// Check if date is weekend
const isWeekend = async (date) => {
    const dayName = moment(date).format('dddd').toLowerCase();
    const weekendConfig = await WeekendConfig.findOne({ dayOfWeek: dayName });
    return weekendConfig ? weekendConfig.isWeekend : (dayName === 'saturday' || dayName === 'sunday');
};

// Check if date is holiday
const isHoliday = async (date) => {
    const holiday = await Holiday.findOne({
        date: {
            $gte: moment(date).startOf('day').toDate(),
            $lte: moment(date).endOf('day').toDate()
        },
        isActive: true
    });
    return !!holiday;
};

// @desc    Check-in
// @route   POST /api/attendance/check-in
// @access  Private
exports.checkIn = async (req, res) => {
    try {
        const { location, latitude, longitude, device, photoUrl } = req.body;
        const userId = req.user.id;
        const today = moment().startOf('day').toDate();
        const now = new Date();

        // Check if already checked in today
        let attendance = await AttendanceRecord.findOne({ user: userId, date: today });

        if (attendance && attendance.checkIn.time) {
            return errorResponse(res, 'Already checked in today', 400);
        }

        const rule = await getUserRule(userId);
        const checkInTime = moment(rule.checkInTime, 'HH:mm');
        const currentTime = moment(now);
        const graceEnd = checkInTime.clone().add(rule.gracePeriodMinutes, 'minutes');

        const isLate = currentTime.isAfter(graceEnd);
        const lateMinutes = isLate ? currentTime.diff(checkInTime, 'minutes') : 0;

        if (!attendance) {
            attendance = new AttendanceRecord({
                user: userId,
                date: today,
                status: 'present'
            });
        }

        attendance.checkIn = {
            time: now,
            location,
            ipAddress: req.ip,
            device,
            photoUrl,
            latitude,
            longitude
        };
        attendance.isLate = isLate;
        attendance.lateMinutes = lateMinutes;

        await attendance.save();

        logger.info(`User ${userId} checked in at ${now}`);
        return successResponse(res, attendance, 'Checked in successfully');
    } catch (error) {
        logger.error('Check-in error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Check-out
// @route   POST /api/attendance/check-out
// @access  Private
exports.checkOut = async (req, res) => {
    try {
        const { location, latitude, longitude, device, photoUrl } = req.body;
        const userId = req.user.id;
        const today = moment().startOf('day').toDate();
        const now = new Date();

        const attendance = await AttendanceRecord.findOne({ user: userId, date: today });

        if (!attendance || !attendance.checkIn.time) {
            return errorResponse(res, 'Please check-in first', 400);
        }

        if (attendance.checkOut.time) {
            return errorResponse(res, 'Already checked out today', 400);
        }

        const rule = await getUserRule(userId);
        const checkOutTime = moment(rule.checkOutTime, 'HH:mm');
        const currentTime = moment(now);

        const isEarlyLeave = currentTime.isBefore(checkOutTime);
        const earlyLeaveMinutes = isEarlyLeave ? checkOutTime.diff(currentTime, 'minutes') : 0;

        // Calculate working hours
        const checkInMoment = moment(attendance.checkIn.time);
        const workingHours = currentTime.diff(checkInMoment, 'hours', true);

        // Calculate overtime
        const overtimeHours = workingHours > rule.overtimeThreshold
            ? workingHours - rule.overtimeThreshold
            : 0;

        attendance.checkOut = {
            time: now,
            location,
            ipAddress: req.ip,
            device,
            photoUrl,
            latitude,
            longitude
        };
        attendance.workingHours = parseFloat(workingHours.toFixed(2));
        attendance.overtimeHours = parseFloat(overtimeHours.toFixed(2));
        attendance.isEarlyLeave = isEarlyLeave;
        attendance.earlyLeaveMinutes = earlyLeaveMinutes;
        attendance.isOvertime = overtimeHours > 0;

        // Determine status
        if (workingHours >= rule.halfDayHours && workingHours < rule.fullDayHours) {
            attendance.status = 'half_day';
        } else if (workingHours >= rule.fullDayHours) {
            attendance.status = 'present';
        }

        await attendance.save();

        logger.info(`User ${userId} checked out at ${now}`);
        return successResponse(res, attendance, 'Checked out successfully');
    } catch (error) {
        logger.error('Check-out error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get attendance history
// @route   GET /api/attendance/history
// @access  Private
exports.getAttendanceHistory = async (req, res) => {
    try {
        const { page = 1, limit = 30, startDate, endDate } = req.query;
        const userId = req.user.id;

        const query = { user: userId };
        if (startDate && endDate) {
            query.date = {
                $gte: moment(startDate).startOf('day').toDate(),
                $lte: moment(endDate).endOf('day').toDate()
            };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await AttendanceRecord.countDocuments(query);

        const records = await AttendanceRecord.find(query)
            .sort({ date: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, records, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get attendance history error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get all attendance records (Admin)
// @route   GET /api/attendance/all
// @access  Private/Admin
exports.getAllAttendance = async (req, res) => {
    try {
        const { page = 1, limit = 50, userId, startDate, endDate, status } = req.query;

        const query = {};
        if (userId) query.user = userId;
        if (status) query.status = status;
        if (startDate && endDate) {
            query.date = {
                $gte: moment(startDate).startOf('day').toDate(),
                $lte: moment(endDate).endOf('day').toDate()
            };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await AttendanceRecord.countDocuments(query);

        const records = await AttendanceRecord.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .sort({ date: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, records, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get all attendance error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get today's attendance status
// @route   GET /api/attendance/today
// @access  Private
exports.getTodayAttendance = async (req, res) => {
    try {
        const userId = req.user.id;
        const today = moment().startOf('day').toDate();

        const attendance = await AttendanceRecord.findOne({ user: userId, date: today });

        if (!attendance) {
            return successResponse(res, {
                checkedIn: false,
                checkedOut: false,
                date: today
            }, 'No attendance record for today');
        }

        return successResponse(res, {
            checkedIn: !!attendance.checkIn.time,
            checkedOut: !!attendance.checkOut.time,
            checkInTime: attendance.checkIn.time,
            checkOutTime: attendance.checkOut.time,
            status: attendance.status,
            workingHours: attendance.workingHours,
            isLate: attendance.isLate,
            isEarlyLeave: attendance.isEarlyLeave
        }, 'Today attendance status');
    } catch (error) {
        logger.error('Get today attendance error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Request attendance correction (e.g. forgot to check-in/check-out on a given day)
// @route   POST /api/attendance/correction
// @access  Private
exports.requestCorrection = async (req, res) => {
    try {
        const { attendanceRecordId, date, requestedCheckIn, requestedCheckOut, reason } = req.body;
        const userId = req.user.id;

        if (!reason) {
            return errorResponse(res, 'Reason is required', 400);
        }

        if (!requestedCheckIn && !requestedCheckOut) {
            return errorResponse(res, 'Provide a requested check-in and/or check-out time', 400);
        }

        let attendance = null;
        let recordDate;

        if (attendanceRecordId) {
            // Correcting an existing record (e.g. wrong check-in time)
            attendance = await AttendanceRecord.findOne({ _id: attendanceRecordId, user: userId });
            if (!attendance) {
                return errorResponse(res, 'Attendance record not found', 404);
            }
            recordDate = attendance.date;
        } else {
            // No record exists yet (employee forgot to check-in/check-out entirely) - identify by date
            if (!date) {
                return errorResponse(res, 'Date is required', 400);
            }
            recordDate = moment(date).startOf('day').toDate();

            if (moment(recordDate).isAfter(moment().startOf('day'))) {
                return errorResponse(res, 'Cannot request correction for a future date', 400);
            }

            attendance = await AttendanceRecord.findOne({ user: userId, date: recordDate });
        }

        if (attendance && attendance.isLocked) {
            return errorResponse(res, 'Attendance is locked and cannot be corrected', 400);
        }

        const existingPending = await AttendanceCorrectionRequest.findOne({
            user: userId,
            date: recordDate,
            status: 'pending'
        });

        if (existingPending) {
            return errorResponse(res, 'A pending correction request already exists for this date', 400);
        }

        const correctionRequest = await AttendanceCorrectionRequest.create({
            user: userId,
            attendanceRecord: attendance ? attendance._id : undefined,
            date: recordDate,
            requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : null,
            requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
            reason
        });

        // Notify admins so they can review the request
        const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
        if (admins.length > 0) {
            const employee = await User.findById(userId).select('firstName lastName');
            await Notification.insertMany(admins.map((admin) => ({
                user: admin._id,
                title: 'New Attendance Correction Request',
                message: `${employee.firstName} ${employee.lastName} requested an attendance correction for ${moment(recordDate).format('DD MMM YYYY')}`,
                type: 'info',
                actionUrl: '/attendance/corrections'
            })));
        }

        logger.info(`Correction request created by user ${userId}`);
        return successResponse(res, correctionRequest, 'Correction request submitted', 201);
    } catch (error) {
        logger.error('Correction request error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get my correction requests
// @route   GET /api/attendance/my-corrections
// @access  Private
exports.getMyCorrectionRequests = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const userId = req.user.id;

        const query = { user: userId };
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await AttendanceCorrectionRequest.countDocuments(query);

        const requests = await AttendanceCorrectionRequest.find(query)
            .populate('approvedBy', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, requests, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get my correction requests error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get correction requests (Admin)
// @route   GET /api/attendance/corrections
// @access  Private/Admin
exports.getCorrectionRequests = async (req, res) => {
    try {
        const { status = 'pending', page = 1, limit = 20 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await AttendanceCorrectionRequest.countDocuments({ status });

        const requests = await AttendanceCorrectionRequest.find({ status })
            .populate('user', 'firstName lastName employeeCode')
            .populate('attendanceRecord')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, requests, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get correction requests error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve/Reject correction request
// @route   PUT /api/attendance/corrections/:id
// @access  Private/Admin
exports.handleCorrectionRequest = async (req, res) => {
    try {
        const { status, rejectionReason } = req.body;
        const requestId = req.params.id;

        const correctionRequest = await AttendanceCorrectionRequest.findById(requestId);
        if (!correctionRequest) {
            return errorResponse(res, 'Correction request not found', 404);
        }

        if (correctionRequest.status !== 'pending') {
            return errorResponse(res, 'Correction request has already been processed', 400);
        }

        // Backfill date on legacy correction requests that predate the required `date` field
        if (!correctionRequest.date && correctionRequest.attendanceRecord) {
            const linkedRecord = await AttendanceRecord.findById(correctionRequest.attendanceRecord);
            if (linkedRecord) {
                correctionRequest.date = linkedRecord.date;
            }
        }

        correctionRequest.status = status;
        correctionRequest.approvedBy = req.user.id;
        correctionRequest.approvedAt = new Date();
        if (status === 'rejected') {
            correctionRequest.rejectionReason = rejectionReason;
        }

        await correctionRequest.save();

        // If approved, update (or create) the underlying attendance record
        if (status === 'approved') {
            let attendance = correctionRequest.attendanceRecord
                ? await AttendanceRecord.findById(correctionRequest.attendanceRecord)
                : await AttendanceRecord.findOne({ user: correctionRequest.user, date: correctionRequest.date });

            if (!attendance) {
                attendance = new AttendanceRecord({
                    user: correctionRequest.user,
                    date: correctionRequest.date,
                    status: 'present'
                });
            }

            if (correctionRequest.requestedCheckIn) {
                attendance.checkIn.time = correctionRequest.requestedCheckIn;
            }
            if (correctionRequest.requestedCheckOut) {
                attendance.checkOut.time = correctionRequest.requestedCheckOut;
            }

            // Recalculate working hours/status once both check-in and check-out are known
            if (attendance.checkIn.time && attendance.checkOut.time) {
                const rule = await getUserRule(correctionRequest.user);
                const workingHours = moment(attendance.checkOut.time).diff(moment(attendance.checkIn.time), 'hours', true);

                attendance.workingHours = parseFloat(Math.max(workingHours, 0).toFixed(2));
                attendance.overtimeHours = rule && workingHours > rule.overtimeThreshold
                    ? parseFloat((workingHours - rule.overtimeThreshold).toFixed(2))
                    : 0;
                attendance.isOvertime = attendance.overtimeHours > 0;
                attendance.status = rule && workingHours >= rule.halfDayHours && workingHours < rule.fullDayHours
                    ? 'half_day'
                    : 'present';
            } else if (attendance.checkIn.time) {
                attendance.status = 'present';
            }

            attendance.approvedBy = req.user.id;
            attendance.approvedAt = new Date();

            await attendance.save();

            if (!correctionRequest.attendanceRecord) {
                correctionRequest.attendanceRecord = attendance._id;
                await correctionRequest.save();
            }
        }

        // Notify the employee of the outcome
        await Notification.create({
            user: correctionRequest.user,
            title: `Attendance Correction ${status === 'approved' ? 'Approved' : 'Rejected'}`,
            message: status === 'approved'
                ? `Your attendance correction request for ${moment(correctionRequest.date).format('DD MMM YYYY')} has been approved.`
                : `Your attendance correction request for ${moment(correctionRequest.date).format('DD MMM YYYY')} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
            type: status === 'approved' ? 'success' : 'error',
            actionUrl: '/attendance/my-corrections'
        });

        logger.info(`Correction request ${status} by admin ${req.user.id}`);
        return successResponse(res, correctionRequest, `Correction request ${status}`);
    } catch (error) {
        logger.error('Handle correction error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Lock attendance for a period
// @route   POST /api/attendance/lock
// @access  Private/Admin
exports.lockAttendance = async (req, res) => {
    try {
        const { startDate, endDate, userIds } = req.body;

        const query = {
            date: {
                $gte: moment(startDate).startOf('day').toDate(),
                $lte: moment(endDate).endOf('day').toDate()
            }
        };

        if (userIds && userIds.length > 0) {
            query.user = { $in: userIds };
        }

        const result = await AttendanceRecord.updateMany(query, {
            $set: {
                isLocked: true,
                lockedAt: new Date(),
                lockedBy: req.user.id
            }
        });

        logger.info(`Attendance locked for period ${startDate} to ${endDate}`);
        return successResponse(res, { modifiedCount: result.modifiedCount }, 'Attendance locked successfully');
    } catch (error) {
        logger.error('Lock attendance error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get working hours summary
// @route   GET /api/attendance/working-hours
// @access  Private
exports.getWorkingHours = async (req, res) => {
    try {
        const userId = req.user.id;
        const { month, year } = req.query;

        const startOfMonth = moment(`${year}-${month}-01`).startOf('month').toDate();
        const endOfMonth = moment(startOfMonth).endOf('month').toDate();

        const records = await AttendanceRecord.find({
            user: userId,
            date: { $gte: startOfMonth, $lte: endOfMonth },
            status: { $in: ['present', 'half_day', 'wfh'] }
        });

        const totalWorkingHours = records.reduce((sum, r) => sum + (r.workingHours || 0), 0);
        const totalOvertime = records.reduce((sum, r) => sum + (r.overtimeHours || 0), 0);
        const presentDays = records.filter(r => r.status === 'present').length;
        const halfDays = records.filter(r => r.status === 'half_day').length;

        return successResponse(res, {
            totalWorkingHours: parseFloat(totalWorkingHours.toFixed(2)),
            totalOvertime: parseFloat(totalOvertime.toFixed(2)),
            presentDays,
            halfDays,
            totalDays: presentDays + halfDays * 0.5
        }, 'Working hours summary');
    } catch (error) {
        logger.error('Get working hours error:', error);
        return errorResponse(res, error.message, 500);
    }
};
