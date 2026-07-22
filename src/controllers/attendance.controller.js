const moment = require('moment-timezone');
const AttendanceRecord = require('../models/AttendanceRecord');
const User = require('../models/User');
const AttendanceRule = require('../models/AttendanceRule');
const EmployeeRule = require('../models/EmployeeRule');
const WeekendConfig = require('../models/WeekendConfig');
const Holiday = require('../models/Holiday');
const LeaveRequest = require('../models/LeaveRequest');
const AttendanceCorrectionRequest = require('../models/AttendanceCorrectionRequest');
const Notification = require('../models/Notification');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// Used only if no AttendanceRule document exists at all yet (e.g. a brand
// new deployment before an admin has visited Settings) so check-in/out never
// hard-crashes for lack of configuration.
const FALLBACK_RULE = {
    checkInTime: '09:00',
    checkOutTime: '18:00',
    gracePeriodMinutes: 15,
    graceBeforeMinutes: 0,
    allowedEarlyCheckinMinutes: 60,
    earlyCheckinAction: 'mark',
    halfDayHours: 4,
    fullDayHours: 8,
    absentThresholdHours: 2,
    overtimeThreshold: 8,
    lunchBreakMinutes: 0
};

// Get user's attendance rule
const getUserRule = async (userId) => {
    const employeeRule = await EmployeeRule.findOne({
        user: userId,
        effectiveFrom: { $lte: new Date() },
        $or: [{ effectiveTo: { $gte: new Date() } }, { effectiveTo: null }]
    }).populate('rule');

    if (employeeRule) return employeeRule.rule;

    const defaultRule = await AttendanceRule.findOne({ isDefault: true, isActive: true });
    return defaultRule || FALLBACK_RULE;
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

// Check if the user has an approved leave covering this date
const isOnApprovedLeave = async (userId, date) => {
    const leave = await LeaveRequest.findOne({
        user: userId,
        status: 'approved',
        startDate: { $lte: moment(date).endOf('day').toDate() },
        endDate: { $gte: moment(date).startOf('day').toDate() }
    });
    return !!leave;
};

// Shared checkout math - used by the live checkout endpoint AND by admin
// approval of a backfilled correction request, so the two paths can never
// disagree on how a day's status/hours/flags are derived.
const computeCheckoutOutcome = (rule, checkInTime, checkOutTime) => {
    const checkInMoment = moment(checkInTime);
    const checkOutMoment = moment(checkOutTime);
    const officeEnd = moment(rule.checkOutTime, 'HH:mm');

    const workingHours = Math.max(checkOutMoment.diff(checkInMoment, 'hours', true), 0);
    const workingMinutes = Math.max(checkOutMoment.diff(checkInMoment, 'minutes'), 0);

    const overtimeHours = workingHours > rule.overtimeThreshold ? workingHours - rule.overtimeThreshold : 0;

    const isEarlyLeave = checkOutMoment.isBefore(officeEnd);
    const earlyLeaveMinutes = isEarlyLeave ? officeEnd.diff(checkOutMoment, 'minutes') : 0;

    // Absent/half-day/present ladder: below absentThresholdHours -> Absent
    // outright (regardless of half/full day thresholds); below fullDayHours
    // -> Half Day; otherwise a full Present day. (halfDayHours is kept on the
    // rule for display/back-compat but absentThresholdHours now owns the
    // lower edge of the Half Day band, closing a gap where very short days
    // used to silently stay "present".)
    let status;
    if (workingHours < (rule.absentThresholdHours ?? 0)) {
        status = 'absent';
    } else if (workingHours < rule.fullDayHours) {
        status = 'half_day';
    } else {
        status = 'present';
    }

    return {
        workingHours: parseFloat(workingHours.toFixed(2)),
        workingMinutes,
        overtimeHours: parseFloat(overtimeHours.toFixed(2)),
        overtimeMinutes: Math.round(overtimeHours * 60),
        isOvertime: overtimeHours > 0,
        isEarlyLeave,
        earlyLeaveMinutes,
        status,
        isHalfDay: status === 'half_day',
        isAbsent: status === 'absent'
    };
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

        if (await isWeekend(today)) {
            return errorResponse(res, 'Cannot check in - today is a week off', 400);
        }
        if (await isHoliday(today)) {
            return errorResponse(res, 'Cannot check in - today is a holiday', 400);
        }
        if (await isOnApprovedLeave(userId, today)) {
            return errorResponse(res, 'Cannot check in - you are on approved leave today', 400);
        }

        const rule = await getUserRule(userId);
        const officeStart = moment(rule.checkInTime, 'HH:mm');
        const currentTime = moment(now);

        const earliestAllowed = officeStart.clone().subtract(rule.allowedEarlyCheckinMinutes || 0, 'minutes');
        const graceBeforeStart = officeStart.clone().subtract(rule.graceBeforeMinutes || 0, 'minutes');
        const graceAfterEnd = officeStart.clone().add(rule.gracePeriodMinutes || 0, 'minutes');

        let isEarlyCheckin = false;
        let earlyCheckinMinutes = 0;
        if (currentTime.isBefore(earliestAllowed)) {
            if (rule.earlyCheckinAction === 'reject') {
                return errorResponse(res, `Check-in is not allowed before ${earliestAllowed.format('hh:mm A')}`, 400);
            }
            isEarlyCheckin = true;
            earlyCheckinMinutes = officeStart.diff(currentTime, 'minutes');
        } else if (currentTime.isBefore(graceBeforeStart)) {
            isEarlyCheckin = true;
            earlyCheckinMinutes = officeStart.diff(currentTime, 'minutes');
        }

        const isLate = currentTime.isAfter(graceAfterEnd);
        const lateMinutes = isLate ? currentTime.diff(officeStart, 'minutes') : 0;
        // Grace "used" = arrived after office start but still within the
        // after-grace window, i.e. grace is the only reason this isn't Late.
        const isGraceUsed = !isLate && currentTime.isAfter(officeStart);

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
        attendance.status = 'present';
        attendance.isLate = isLate;
        attendance.lateMinutes = lateMinutes;
        attendance.isEarlyCheckin = isEarlyCheckin;
        attendance.earlyCheckinMinutes = earlyCheckinMinutes;
        attendance.isGraceUsed = isGraceUsed;
        attendance.officeStartTime = rule.checkInTime;
        attendance.officeEndTime = rule.checkOutTime;
        attendance.graceBeforeMinutes = rule.graceBeforeMinutes || 0;
        attendance.graceAfterMinutes = rule.gracePeriodMinutes || 0;
        attendance.allowedEarlyCheckinMinutes = rule.allowedEarlyCheckinMinutes || 0;

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
        const outcome = computeCheckoutOutcome(rule, attendance.checkIn.time, now);

        attendance.checkOut = {
            time: now,
            location,
            ipAddress: req.ip,
            device,
            photoUrl,
            latitude,
            longitude
        };
        attendance.workingHours = outcome.workingHours;
        attendance.workingMinutes = outcome.workingMinutes;
        attendance.overtimeHours = outcome.overtimeHours;
        attendance.overtimeMinutes = outcome.overtimeMinutes;
        attendance.isOvertime = outcome.isOvertime;
        attendance.isEarlyLeave = outcome.isEarlyLeave;
        attendance.earlyLeaveMinutes = outcome.earlyLeaveMinutes;
        attendance.status = outcome.status;
        attendance.isHalfDay = outcome.isHalfDay;
        attendance.isAbsent = outcome.isAbsent;
        attendance.officeEndTime = rule.checkOutTime;

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
        const rule = await getUserRule(userId);

        if (!attendance) {
            return successResponse(res, {
                checkedIn: false,
                checkedOut: false,
                date: today,
                officeStartTime: rule.checkInTime,
                officeEndTime: rule.checkOutTime,
                graceBeforeMinutes: rule.graceBeforeMinutes || 0,
                graceAfterMinutes: rule.gracePeriodMinutes || 0
            }, 'No attendance record for today');
        }

        return successResponse(res, {
            checkedIn: !!attendance.checkIn.time,
            checkedOut: !!attendance.checkOut.time,
            checkInTime: attendance.checkIn.time,
            checkOutTime: attendance.checkOut.time,
            status: attendance.status,
            workingHours: attendance.workingHours,
            workingMinutes: attendance.workingMinutes,
            overtimeHours: attendance.overtimeHours,
            overtimeMinutes: attendance.overtimeMinutes,
            isLate: attendance.isLate,
            lateMinutes: attendance.lateMinutes,
            isEarlyLeave: attendance.isEarlyLeave,
            earlyLeaveMinutes: attendance.earlyLeaveMinutes,
            isEarlyCheckin: attendance.isEarlyCheckin,
            earlyCheckinMinutes: attendance.earlyCheckinMinutes,
            isGraceUsed: attendance.isGraceUsed,
            isHalfDay: attendance.isHalfDay,
            isAbsent: attendance.isAbsent,
            officeStartTime: attendance.officeStartTime || rule.checkInTime,
            officeEndTime: attendance.officeEndTime || rule.checkOutTime,
            graceBeforeMinutes: attendance.graceBeforeMinutes ?? (rule.graceBeforeMinutes || 0),
            graceAfterMinutes: attendance.graceAfterMinutes ?? (rule.gracePeriodMinutes || 0)
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
                const outcome = computeCheckoutOutcome(rule, attendance.checkIn.time, attendance.checkOut.time);

                attendance.workingHours = outcome.workingHours;
                attendance.workingMinutes = outcome.workingMinutes;
                attendance.overtimeHours = outcome.overtimeHours;
                attendance.overtimeMinutes = outcome.overtimeMinutes;
                attendance.isOvertime = outcome.isOvertime;
                attendance.isEarlyLeave = outcome.isEarlyLeave;
                attendance.earlyLeaveMinutes = outcome.earlyLeaveMinutes;
                attendance.status = outcome.status;
                attendance.isHalfDay = outcome.isHalfDay;
                attendance.isAbsent = outcome.isAbsent;
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

// Office hours implied by checkInTime/checkOutTime minus the optional lunch
// break - display-only, never subtracted from an employee's actual clocked
// working hours.
const computeExpectedWorkingHours = (rule) => {
    const start = moment(rule.checkInTime, 'HH:mm');
    const end = moment(rule.checkOutTime, 'HH:mm');
    const minutes = Math.max(end.diff(start, 'minutes') - (rule.lunchBreakMinutes || 0), 0);
    return parseFloat((minutes / 60).toFixed(2));
};

const getOrCreateDefaultRule = async () => {
    let rule = await AttendanceRule.findOne({ isDefault: true });
    if (!rule) {
        rule = await AttendanceRule.create({ ruleName: 'Default Attendance Rule', isDefault: true, isActive: true });
    }
    return rule;
};

// @desc    Get the default attendance timing/grace-period settings
// @route   GET /api/attendance/settings
// @access  Private/Admin
exports.getAttendanceSettings = async (req, res) => {
    try {
        const rule = await getOrCreateDefaultRule();
        return successResponse(res, {
            ...rule.toObject(),
            expectedWorkingHours: computeExpectedWorkingHours(rule)
        }, 'Attendance settings retrieved');
    } catch (error) {
        logger.error('Get attendance settings error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update the default attendance timing/grace-period settings
// @route   PUT /api/attendance/settings
// @access  Private/Admin
exports.updateAttendanceSettings = async (req, res) => {
    try {
        const {
            checkInTime, checkOutTime, gracePeriodMinutes, graceBeforeMinutes,
            allowedEarlyCheckinMinutes, earlyCheckinAction, halfDayHours, fullDayHours,
            absentThresholdHours, overtimeThreshold, lunchBreakMinutes
        } = req.body;

        const timeFormat = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (checkInTime !== undefined && !timeFormat.test(checkInTime)) {
            return errorResponse(res, 'Office start time must be in HH:mm format', 400);
        }
        if (checkOutTime !== undefined && !timeFormat.test(checkOutTime)) {
            return errorResponse(res, 'Office end time must be in HH:mm format', 400);
        }

        const rule = await getOrCreateDefaultRule();

        if (checkInTime !== undefined) rule.checkInTime = checkInTime;
        if (checkOutTime !== undefined) rule.checkOutTime = checkOutTime;
        if (moment(rule.checkOutTime, 'HH:mm').isSameOrBefore(moment(rule.checkInTime, 'HH:mm'))) {
            return errorResponse(res, 'Office end time must be after office start time', 400);
        }
        if (gracePeriodMinutes !== undefined) rule.gracePeriodMinutes = gracePeriodMinutes;
        if (graceBeforeMinutes !== undefined) rule.graceBeforeMinutes = graceBeforeMinutes;
        if (allowedEarlyCheckinMinutes !== undefined) rule.allowedEarlyCheckinMinutes = allowedEarlyCheckinMinutes;
        if (earlyCheckinAction !== undefined) rule.earlyCheckinAction = earlyCheckinAction;
        if (halfDayHours !== undefined) rule.halfDayHours = halfDayHours;
        if (fullDayHours !== undefined) rule.fullDayHours = fullDayHours;
        if (absentThresholdHours !== undefined) rule.absentThresholdHours = absentThresholdHours;
        if (overtimeThreshold !== undefined) rule.overtimeThreshold = overtimeThreshold;
        if (lunchBreakMinutes !== undefined) rule.lunchBreakMinutes = lunchBreakMinutes;
        rule.isDefault = true;
        rule.isActive = true;

        await rule.save();

        logger.info(`Attendance settings updated by admin ${req.user.id}`);
        return successResponse(res, {
            ...rule.toObject(),
            expectedWorkingHours: computeExpectedWorkingHours(rule)
        }, 'Attendance settings updated');
    } catch (error) {
        logger.error('Update attendance settings error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    A single employee's raw attendance records (self or admin)
// @route   GET /api/attendance/employee/:id
// @access  Private (self) / Private/Admin (any)
exports.getEmployeeAttendance = async (req, res) => {
    try {
        const { id } = req.params;
        if (req.user.role !== 'admin' && req.user.id !== id) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const { page = 1, limit = 30, startDate, endDate, status } = req.query;
        const query = { user: id };
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
        logger.error('Get employee attendance error:', error);
        return errorResponse(res, error.message, 500);
    }
};
