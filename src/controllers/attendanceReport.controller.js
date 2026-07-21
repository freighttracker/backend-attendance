const moment = require('moment-timezone');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const WeekendConfig = require('../models/WeekendConfig');
const SalarySlip = require('../models/SalarySlip');
const SalaryStructure = require('../models/SalaryStructure');
const { getMonthlyAttendanceSummary, computeSalaryDays, round2 } = require('../services/payroll.service');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

function fullName(user) {
    return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.employeeCode;
}

// Today's at-a-glance status per employee, resolved in a handful of bulk
// queries (not one per employee) so it stays cheap to compute even for a
// large filtered employee list.
async function getTodayStatusMap(userIds) {
    const dayStart = moment.tz(TZ).startOf('day').toDate();
    const dayEnd = moment.tz(TZ).endOf('day').toDate();
    const dayOfWeek = moment.tz(TZ).format('dddd').toLowerCase();

    const [records, weekendConfigs, holidays, leaves] = await Promise.all([
        AttendanceRecord.find({ user: { $in: userIds }, date: { $gte: dayStart, $lte: dayEnd } }),
        WeekendConfig.find({ isWeekend: true, isActive: true }),
        Holiday.find({ isActive: true, date: { $gte: dayStart, $lte: dayEnd } }),
        LeaveRequest.find({ user: { $in: userIds }, status: 'approved', startDate: { $lte: dayEnd }, endDate: { $gte: dayStart } })
    ]);

    const recordMap = new Map(records.map((r) => [String(r.user), r.status]));
    const leaveSet = new Set(leaves.map((l) => String(l.user)));
    const weekendDaySet = new Set(weekendConfigs.length ? weekendConfigs.map((w) => w.dayOfWeek) : ['saturday', 'sunday']);
    const isWeekend = weekendDaySet.has(dayOfWeek);
    const isHoliday = holidays.length > 0;

    const map = new Map();
    userIds.forEach((id) => {
        const key = String(id);
        if (recordMap.has(key)) { map.set(key, recordMap.get(key)); return; }
        if (isWeekend) { map.set(key, 'weekend'); return; }
        if (isHoliday) { map.set(key, 'holiday'); return; }
        if (leaveSet.has(key)) { map.set(key, 'on_leave'); return; }
        map.set(key, 'absent');
    });
    return map;
}

// Prefers the actual generated slip's real gross/net for the month; falls
// back to an estimate derived from the active salary structure and this
// month's salary-day count when no slip has been generated yet. `salarySource`
// tells the frontend which one it's looking at so it can label it honestly.
async function resolveSalaryFigures(userId, month, year, workingDays, salaryDays) {
    const [slip, structure] = await Promise.all([
        SalarySlip.findOne({ user: userId, month, year }),
        SalaryStructure.findOne({ user: userId, isActive: true })
    ]);

    if (slip) {
        return { grossSalary: slip.grossSalary, netSalary: slip.netSalary, salarySource: 'slip' };
    }
    if (structure && workingDays > 0) {
        const perDay = structure.monthlyGrossSalary / workingDays;
        return { grossSalary: structure.monthlyGrossSalary, netSalary: round2(perDay * salaryDays), salarySource: 'estimated' };
    }
    return { grossSalary: null, netSalary: null, salarySource: 'unavailable' };
}

async function buildEmployeeRow(user, month, year, todayStatus) {
    const attendance = await getMonthlyAttendanceSummary(user._id, month, year);
    const salaryDays = computeSalaryDays(attendance);
    const attendancePct = attendance.workingDays > 0
        ? round2(((attendance.presentDays + attendance.halfDays * 0.5) / attendance.workingDays) * 100)
        : 0;
    const { grossSalary, netSalary, salarySource } = await resolveSalaryFigures(user._id, month, year, attendance.workingDays, salaryDays);

    return {
        id: user._id,
        employeeCode: user.employeeCode,
        name: fullName(user),
        department: user.department || null,
        designation: user.designation || null,
        workingDays: attendance.workingDays,
        presentDays: attendance.presentDays,
        absentDays: attendance.absentDays,
        halfDays: attendance.halfDays,
        paidLeaveDays: attendance.paidLeaveDays,
        unpaidLeaveDays: attendance.unpaidLeaveDays,
        holidays: attendance.holidays,
        weeklyOffs: attendance.weeklyOffs,
        lateCount: attendance.lateCount,
        earlyLeaveCount: attendance.earlyLeaveCount,
        overtimeHours: round2(attendance.overtimeHours),
        attendancePct,
        salaryDays,
        grossSalary,
        netSalary,
        salarySource,
        status: todayStatus
    };
}

function buildSummary(rows) {
    const totalEmployees = rows.length;
    const sum = (key) => round2(rows.reduce((acc, r) => acc + (r[key] || 0), 0));
    const workingDays = rows[0]?.workingDays || 0;
    const presentEquivalent = rows.reduce((acc, r) => acc + r.presentDays + r.halfDays * 0.5, 0);
    const attendancePercentage = workingDays > 0 && totalEmployees > 0
        ? round2((presentEquivalent / (workingDays * totalEmployees)) * 100)
        : 0;

    return {
        totalEmployees,
        presentDays: sum('presentDays'),
        absentDays: sum('absentDays'),
        halfDays: sum('halfDays'),
        paidLeaves: sum('paidLeaveDays'),
        unpaidLeaves: sum('unpaidLeaveDays'),
        weekOffs: sum('weeklyOffs'),
        holidays: sum('holidays'),
        lateCheckIns: sum('lateCount'),
        earlyCheckOuts: sum('earlyLeaveCount'),
        overtimeHours: sum('overtimeHours'),
        attendancePercentage,
        workingDays,
        payrollDays: sum('salaryDays')
    };
}

// @desc    Monthly attendance report - summary cards + per-employee table
// @route   GET /api/attendance/report/monthly
// @access  Private/Admin
exports.getMonthlyReport = async (req, res) => {
    try {
        const now = moment.tz(TZ);
        const month = parseInt(req.query.month) || (now.month() + 1);
        const year = parseInt(req.query.year) || now.year();
        const { department, designation, userId, search, status } = req.query;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit) || 20, 1);

        const userFilter = { role: { $ne: 'admin' } };
        if (department) userFilter.department = department;
        if (designation) userFilter.designation = designation;
        if (userId) userFilter._id = userId;
        if (search) {
            const re = new RegExp(search.trim(), 'i');
            userFilter.$or = [{ firstName: re }, { lastName: re }, { employeeCode: re }];
        }

        let users = await User.find(userFilter)
            .select('firstName lastName employeeCode department designation')
            .sort({ employeeCode: 1 });

        const statusMap = users.length ? await getTodayStatusMap(users.map((u) => u._id)) : new Map();
        if (status) {
            users = users.filter((u) => statusMap.get(String(u._id)) === status);
        }

        // NOTE: summary cards must reflect the whole filtered set, not just the
        // current page, so every matching employee's monthly summary is computed
        // here and only sliced into a page afterwards. Fine at typical HRMS
        // headcounts; if this ever needs to scale to thousands of employees,
        // switch to a single aggregation pipeline instead of per-employee calls.
        const rows = await Promise.all(users.map((u) => buildEmployeeRow(u, month, year, statusMap.get(String(u._id)))));
        const summary = buildSummary(rows);

        const total = rows.length;
        const start = (page - 1) * limit;
        const employees = rows.slice(start, start + limit);

        return paginatedResponse(res, { month, year, summary, employees }, {
            page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1)
        }, 'Monthly attendance report retrieved');
    } catch (error) {
        logger.error('Get monthly attendance report error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    A single employee's monthly attendance report (self or admin)
// @route   GET /api/attendance/report/employee/:id
// @access  Private (self) / Private/Admin (any)
exports.getEmployeeReport = async (req, res) => {
    try {
        const { id } = req.params;
        if (req.user.role !== 'admin' && req.user.id !== id) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const user = await User.findById(id).select('firstName lastName employeeCode department designation');
        if (!user) return errorResponse(res, 'Employee not found', 404);

        const now = moment.tz(TZ);
        const month = parseInt(req.query.month) || (now.month() + 1);
        const year = parseInt(req.query.year) || now.year();

        const attendance = await getMonthlyAttendanceSummary(id, month, year);
        const salaryDays = computeSalaryDays(attendance);
        const attendancePct = attendance.workingDays > 0
            ? round2(((attendance.presentDays + attendance.halfDays * 0.5) / attendance.workingDays) * 100)
            : 0;
        const { netSalary } = await resolveSalaryFigures(id, month, year, attendance.workingDays, salaryDays);

        return successResponse(res, {
            month,
            year,
            employee: {
                id: user._id,
                employeeCode: user.employeeCode,
                name: fullName(user),
                department: user.department || null,
                designation: user.designation || null
            },
            workingDays: attendance.workingDays,
            presentDays: attendance.presentDays,
            absentDays: attendance.absentDays,
            halfDays: attendance.halfDays,
            paidLeaveDays: attendance.paidLeaveDays,
            unpaidLeaveDays: attendance.unpaidLeaveDays,
            holidays: attendance.holidays,
            weeklyOffs: attendance.weeklyOffs,
            lateCount: attendance.lateCount,
            earlyLeaveCount: attendance.earlyLeaveCount,
            overtimeHours: round2(attendance.overtimeHours),
            attendancePct,
            expectedSalaryDays: salaryDays,
            currentMonthSalaryEstimate: netSalary
        }, 'Employee attendance report retrieved');
    } catch (error) {
        logger.error('Get employee attendance report error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Today + month-to-date attendance dashboard
// @route   GET /api/attendance/dashboard
// @access  Private/Admin
exports.getAttendanceDashboard = async (req, res) => {
    try {
        const now = moment.tz(TZ);
        const month = parseInt(req.query.month) || (now.month() + 1);
        const year = parseInt(req.query.year) || now.year();

        const employees = await User.find({ role: { $ne: 'admin' } }).select('_id');
        const totalEmployees = employees.length;
        const employeeIds = employees.map((e) => e._id);

        const dayStart = moment.tz(TZ).startOf('day').toDate();
        const dayEnd = moment.tz(TZ).endOf('day').toDate();
        const todayRecords = await AttendanceRecord.find({ user: { $in: employeeIds }, date: { $gte: dayStart, $lte: dayEnd } });

        const presentToday = todayRecords.filter((r) => r.status === 'present' || r.status === 'wfh').length;
        const absentToday = todayRecords.filter((r) => r.status === 'absent').length;
        const halfDayToday = todayRecords.filter((r) => r.status === 'half_day').length;
        const onLeaveToday = todayRecords.filter((r) => r.status === 'on_leave').length;
        const lateEmployees = todayRecords.filter((r) => r.isLate).length;
        const employeesCheckedIn = todayRecords.filter((r) => r.checkIn?.time).length;
        const employeesCheckedOut = todayRecords.filter((r) => r.checkOut?.time).length;
        const totalWorkingHoursToday = round2(todayRecords.reduce((sum, r) => sum + (r.workingHours || 0), 0));
        const attendancePercentage = totalEmployees > 0 ? round2(((presentToday + halfDayToday * 0.5) / totalEmployees) * 100) : 0;

        // Month-to-date figures reuse the same per-employee summary as the
        // monthly report, so the dashboard and report never disagree.
        const monthlySummaries = await Promise.all(employeeIds.map((id) => getMonthlyAttendanceSummary(id, month, year)));
        const workingDays = monthlySummaries[0]?.workingDays || 0;
        const presentEquivalent = monthlySummaries.reduce((sum, a) => sum + a.presentDays + a.halfDays * 0.5, 0);
        const monthlyAttendancePercentage = workingDays > 0 && totalEmployees > 0
            ? round2((presentEquivalent / (workingDays * totalEmployees)) * 100)
            : 0;
        const payrollDays = round2(monthlySummaries.reduce((sum, a) => sum + computeSalaryDays(a), 0));

        return successResponse(res, {
            month,
            year,
            totalEmployees,
            presentToday,
            absentToday,
            halfDayToday,
            onLeaveToday,
            lateEmployees,
            employeesCheckedIn,
            employeesCheckedOut,
            attendancePercentage,
            monthlyAttendancePercentage,
            totalWorkingHoursToday,
            payrollDays
        }, 'Attendance dashboard retrieved');
    } catch (error) {
        logger.error('Get attendance dashboard error:', error);
        return errorResponse(res, error.message, 500);
    }
};
