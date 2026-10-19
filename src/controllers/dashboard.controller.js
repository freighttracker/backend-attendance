const moment = require('moment-timezone');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const AttendanceCorrectionRequest = require('../models/AttendanceCorrectionRequest');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const WeekendConfig = require('../models/WeekendConfig');
const SalarySlip = require('../models/SalarySlip');
const { scopeFilter } = require('../middleware/scope.middleware');
const { markMissedCheckoutsAsHalfDay } = require('../services/attendance.service');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';
// Only people who actually mark attendance - admin-tier accounts would
// otherwise show up as "not checked in" every single day.
const STAFF_ROLES = ['employee', 'manager'];
const TREND_DAYS = 7;
// How far ahead birthdays and work anniversaries are listed.
const CELEBRATION_DAYS = 30;

const round1 = (n) => Math.round(n * 10) / 10;
const fullName = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();

// Record dates are stamped at the host's local midnight (see toRecordDate in
// attendance.controller), which on a UTC host is not IST midnight - so a day
// is always matched as a range in the office timezone, never by equality.
const dayRange = (day) => ({ $gte: day.clone().startOf('day').toDate(), $lte: day.clone().endOf('day').toDate() });
const dayKey = (date) => moment.tz(date, TZ).format('YYYY-MM-DD');

// If a day somehow has two records for one user, prefer the admin-corrected
// one, then the most recently updated - same rule as findDayRecord.
const preferRecord = (a, b) => (Boolean(a.isCorrected) !== Boolean(b.isCorrected)
    ? Boolean(a.isCorrected)
    : new Date(a.updatedAt) > new Date(b.updatedAt));

// Next time (today or later) the day/month of `date` comes round. A 29 Feb
// date falls on 28 Feb in non-leap years rather than rolling into March.
const nextOccurrence = (date, today) => {
    const d = moment.tz(date, TZ);
    const inYear = (year) => {
        const daysInMonth = moment.tz({ year, month: d.month(), date: 1 }, TZ).daysInMonth();
        return moment.tz({ year, month: d.month(), date: Math.min(d.date(), daysInMonth) }, TZ);
    };
    const thisYear = inYear(today.year());
    return thisYear.isBefore(today, 'day') ? inYear(today.year() + 1) : thisYear;
};

// Employees whose `field` date recurs within the window, soonest first.
// `years` is the count since the original date (age / years of service).
const upcomingCelebrations = (employees, field, today) => employees
    .filter((e) => e[field])
    .map((e) => {
        const next = nextOccurrence(e[field], today);
        return {
            _id: e._id,
            name: fullName(e),
            employeeCode: e.employeeCode,
            department: e.department || null,
            designation: e.designation || null,
            avatarUrl: e.avatarUrl || null,
            date: next.format('YYYY-MM-DD'),
            daysUntil: next.diff(today, 'days'),
            years: next.year() - moment.tz(e[field], TZ).year()
        };
    })
    .filter((c) => c.daysUntil <= CELEBRATION_DAYS)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));

// @desc    Get admin dashboard: today's attendance for every employee plus
//          headline counts, pending approvals and a 7-day trend
// @route   GET /api/dashboard/admin
// @access  Private/Admin (scoped to the caller's company/subcompany)
exports.getAdminDashboard = async (req, res) => {
    try {
        await markMissedCheckoutsAsHalfDay();

        const now = moment.tz(TZ);
        const today = now.clone().startOf('day');
        const todayStr = today.format('YYYY-MM-DD');
        const trendStart = today.clone().subtract(TREND_DAYS - 1, 'days');

        const staff = await User.find({ role: { $in: STAFF_ROLES }, isActive: true, ...scopeFilter(req) })
            .select('firstName lastName employeeCode department designation avatarUrl joiningDate dateOfBirth createdAt')
            .sort({ firstName: 1, lastName: 1 })
            .lean();
        // Someone added ahead of their joining date isn't expected in yet.
        const employees = staff.filter((e) => !e.joiningDate || dayKey(e.joiningDate) <= todayStr);
        const employeeIds = employees.map((e) => e._id);
        const inStaff = { $in: employeeIds };

        const [records, leavesToday, holiday, weekendConfig, pendingLeaves, pendingCorrections, pendingOvertime, upcomingHolidays] = await Promise.all([
            AttendanceRecord.find({ user: inStaff, date: { $gte: trendStart.toDate(), $lte: today.clone().endOf('day').toDate() } })
                .select('user date status checkIn.time checkOut.time workingHours isLate lateMinutes isEarlyLeave earlyLeaveMinutes isCorrected updatedAt')
                .lean(),
            LeaveRequest.find({
                user: inStaff,
                status: 'approved',
                startDate: { $lte: today.clone().endOf('day').toDate() },
                endDate: { $gte: today.toDate() }
            }).select('user leaveType').populate('leaveType', 'name').lean(),
            Holiday.findOne({ isActive: true, date: dayRange(today) }).select('name').lean(),
            WeekendConfig.findOne({ dayOfWeek: today.format('dddd').toLowerCase() }).lean(),
            LeaveRequest.countDocuments({ user: inStaff, status: 'pending' }),
            AttendanceCorrectionRequest.countDocuments({ user: inStaff, status: 'pending' }),
            AttendanceRecord.countDocuments({ user: inStaff, overtimeStatus: 'pending' }),
            Holiday.find({ isActive: true, date: { $gt: today.clone().endOf('day').toDate() } })
                .sort({ date: 1 })
                .limit(3)
                .select('name date type')
                .lean()
        ]);

        // day -> (userId -> record)
        const byDay = new Map();
        for (const r of records) {
            const day = dayKey(r.date);
            if (!byDay.has(day)) byDay.set(day, new Map());
            const dayMap = byDay.get(day);
            const prev = dayMap.get(String(r.user));
            if (!prev || preferRecord(r, prev)) dayMap.set(String(r.user), r);
        }

        const isWeekendToday = weekendConfig ? weekendConfig.isWeekend : [0, 6].includes(today.day());
        const leaveByUser = new Map(leavesToday.map((l) => [String(l.user), l]));
        const todayRecords = byDay.get(todayStr) || new Map();

        // A recorded status always wins; with no record yet the day falls back
        // to approved leave, then holiday/weekend, then "not checked in".
        const rows = employees.map((e) => {
            const id = String(e._id);
            const r = todayRecords.get(id);
            const leave = leaveByUser.get(id);
            let status = 'not_checked_in';
            if (r) status = r.status;
            else if (leave) status = 'on_leave';
            else if (holiday) status = 'holiday';
            else if (isWeekendToday) status = 'weekend';

            return {
                _id: e._id,
                name: fullName(e),
                employeeCode: e.employeeCode,
                department: e.department || null,
                designation: e.designation || null,
                avatarUrl: e.avatarUrl || null,
                status,
                checkIn: r?.checkIn?.time || null,
                checkOut: r?.checkOut?.time || null,
                workingHours: r?.workingHours || 0,
                isWorking: Boolean(r?.checkIn?.time && !r?.checkOut?.time),
                isLate: Boolean(r?.isLate),
                lateMinutes: r?.lateMinutes || 0,
                isEarlyLeave: Boolean(r?.isEarlyLeave),
                earlyLeaveMinutes: r?.earlyLeaveMinutes || 0,
                leaveType: leave?.leaveType?.name || null
            };
        });

        const count = (fn) => rows.filter(fn).length;
        const byStatus = (...statuses) => count((r) => statuses.includes(r.status));
        const summary = {
            totalEmployees: rows.length,
            present: byStatus('present'),
            wfh: byStatus('wfh'),
            halfDay: byStatus('half_day'),
            onLeave: byStatus('on_leave'),
            absent: byStatus('absent'),
            notCheckedIn: byStatus('not_checked_in'),
            offDay: byStatus('weekend', 'holiday'),
            late: count((r) => r.isLate),
            working: count((r) => r.isWorking),
            checkedOut: count((r) => r.checkOut)
        };
        // Rate is out of the people actually expected in today.
        const expected = summary.totalEmployees - summary.offDay - summary.onLeave;
        summary.attendanceRate = expected > 0
            ? round1(((summary.present + summary.wfh + summary.halfDay * 0.5) / expected) * 100)
            : 0;

        // Past days only know about employees who have a record, so the trend
        // charts what was recorded rather than guessing at absences.
        const trend = [];
        for (let i = TREND_DAYS - 1; i >= 0; i--) {
            const d = today.clone().subtract(i, 'days');
            const dayRecords = [...(byDay.get(d.format('YYYY-MM-DD')) || new Map()).values()];
            const c = (...statuses) => dayRecords.filter((r) => statuses.includes(r.status)).length;
            trend.push({
                date: d.format('YYYY-MM-DD'),
                label: d.format('ddd D'),
                present: c('present', 'wfh'),
                halfDay: c('half_day'),
                onLeave: c('on_leave'),
                late: dayRecords.filter((r) => r.isLate).length
            });
        }

        const deptMap = new Map();
        for (const r of rows) {
            const name = r.department || 'Unassigned';
            const d = deptMap.get(name) || { department: name, total: 0, present: 0 };
            d.total += 1;
            if (['present', 'wfh', 'half_day'].includes(r.status)) d.present += 1;
            deptMap.set(name, d);
        }
        const departments = [...deptMap.values()].sort((a, b) => b.total - a.total);

        const monthStartStr = today.clone().startOf('month').format('YYYY-MM-DD');
        const newJoinersThisMonth = employees.filter((e) => dayKey(e.joiningDate || e.createdAt) >= monthStartStr).length;

        const upcomingBirthdays = upcomingCelebrations(employees, 'dateOfBirth', today);
        // The joining day itself isn't an anniversary - only completed years.
        const workAnniversaries = upcomingCelebrations(employees, 'joiningDate', today).filter((a) => a.years >= 1);

        return successResponse(res, {
            date: todayStr,
            generatedAt: now.toISOString(),
            dayType: holiday ? 'holiday' : isWeekendToday ? 'weekend' : 'working',
            holidayName: holiday?.name || null,
            summary,
            pending: {
                leaves: pendingLeaves,
                corrections: pendingCorrections,
                overtime: pendingOvertime
            },
            employees: rows,
            trend,
            departments,
            upcomingHolidays,
            newJoinersThisMonth,
            upcomingBirthdays,
            workAnniversaries
        }, 'Admin dashboard data retrieved');

    } catch (error) {
        logger.error('Admin dashboard error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get employee dashboard stats
// @route   GET /api/dashboard/employee
// @access  Private
exports.getEmployeeDashboard = async (req, res) => {
    try {

        const userId = req.user.id;
        await markMissedCheckoutsAsHalfDay(userId);
        const today = moment().startOf('day').toDate();

        
        const startOfMonth = moment().startOf('month').toDate();
        const endOfMonth = moment().endOf('month').toDate();

        // Today's status
        const todayRecord = await AttendanceRecord.findOne({ user: userId, date: today });

        // Monthly stats
        const monthlyRecords = await AttendanceRecord.find({
            user: userId,
            date: { $gte: startOfMonth, $lte: endOfMonth }
        });

        const presentDays = monthlyRecords.filter(r => r.status === 'present').length;
        const absentDays = monthlyRecords.filter(r => r.status === 'absent').length;
        const leaveDays = monthlyRecords.filter(r => r.status === 'on_leave').length;
        const halfDays = monthlyRecords.filter(r => r.status === 'half_day').length;
        const lateCount = monthlyRecords.filter(r => r.isLate).length;
        const totalWorkingHours = monthlyRecords.reduce((sum, r) => sum + (r.workingHours || 0), 0);
        const totalOvertime = monthlyRecords.reduce((sum, r) => sum + (r.overtimeHours || 0), 0);

        // Pending leave requests
        const pendingLeaves = await LeaveRequest.countDocuments({
            user: userId,
            status: 'pending'
        });

        // Recent attendance
        const recentAttendance = await AttendanceRecord.find({ user: userId })
            .sort({ date: -1 })
            .limit(7);

        return successResponse(res, {
            todayStatus: {
                checkedIn: todayRecord ? !!todayRecord.checkIn.time : false,
                checkedOut: todayRecord ? !!todayRecord.checkOut.time : false,
                status: todayRecord ? todayRecord.status : 'absent',
                workingHours: todayRecord ? todayRecord.workingHours : 0
            },
            monthlyStats: {
                presentDays,
                absentDays,
                leaveDays,
                halfDays,
                lateCount,
                totalWorkingHours: parseFloat(totalWorkingHours.toFixed(2)),
                totalOvertime: parseFloat(totalOvertime.toFixed(2))
            },
            pendingLeaves,
            recentAttendance
        }, 'Employee dashboard data retrieved');

    } catch (error) {
        logger.error('Employee dashboard error:', error);
        return errorResponse(res, error.message, 500);
    }
};
