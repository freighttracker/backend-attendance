const moment = require('moment-timezone');
const LeaveBalance = require('../models/LeaveBalance');
const AttendanceRecord = require('../models/AttendanceRecord');
const WeekendConfig = require('../models/WeekendConfig');
const Holiday = require('../models/Holiday');
const SandwichLeavePolicy = require('../models/SandwichLeavePolicy');
const LeaveRequest = require('../models/LeaveRequest');

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
            // .clone() before startOf/endOf - both mutate in place, and
            // mutating `current` here threw off the loop's own <= comparison
            // and add(1,'day') step, silently undercounting the last day of
            // any multi-day range by one.
            const isHol = await Holiday.findOne({
                date: {
                    $gte: current.clone().startOf('day').toDate(),
                    $lte: current.clone().endOf('day').toDate()
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

// Auto-provisions a LeaveBalance doc on first use for a (user, leaveType, year)
const getOrCreateLeaveBalance = async (userId, leaveType, year) => {
    let balance = await LeaveBalance.findOne({ user: userId, leaveType: leaveType._id, year });
    if (!balance) {
        balance = await LeaveBalance.create({
            user: userId,
            leaveType: leaveType._id,
            year,
            totalDays: leaveType.isUnlimited ? 0 : leaveType.defaultDaysPerYear,
            usedDays: 0,
            pendingDays: 0,
            carryForwardDays: 0
        });
    }
    return balance;
};

// Leave Without Pay always passes regardless of balance
const checkBalanceAvailability = (leaveType, balance, requestedDays) => {
    if (leaveType.isUnlimited) return { ok: true, available: null };
    const available = balance.totalDays + balance.carryForwardDays - balance.usedDays - balance.pendingDays;
    if (available < requestedDays) return { ok: false, available };
    return { ok: true, available };
};

const incrementPending = (userId, leaveTypeId, year, days) =>
    LeaveBalance.findOneAndUpdate(
        { user: userId, leaveType: leaveTypeId, year },
        { $inc: { pendingDays: days } }
    );

const movePendingToUsed = (userId, leaveTypeId, year, days) =>
    LeaveBalance.findOneAndUpdate(
        { user: userId, leaveType: leaveTypeId, year },
        { $inc: { usedDays: days, pendingDays: -days } }
    );

const revertPending = (userId, leaveTypeId, year, days) =>
    LeaveBalance.findOneAndUpdate(
        { user: userId, leaveType: leaveTypeId, year },
        { $inc: { pendingDays: -days } }
    );

const revertUsed = (userId, leaveTypeId, year, days) =>
    LeaveBalance.findOneAndUpdate(
        { user: userId, leaveType: leaveTypeId, year },
        { $inc: { usedDays: -days } }
    );

// Marks/unmarks AttendanceRecord.status = 'on_leave' across a date range,
// never touching a day whose attendance is already payroll-locked.
const syncAttendanceForLeaveRange = async (userId, leaveTypeName, startDate, endDate, mode) => {
    const current = moment(startDate).startOf('day');
    const end = moment(endDate).startOf('day');
    const skippedLockedDates = [];

    while (current.isSameOrBefore(end, 'day')) {
        const date = current.clone().startOf('day').toDate();
        const existing = await AttendanceRecord.findOne({ user: userId, date });

        if (existing && existing.isLocked) {
            skippedLockedDates.push(current.format('YYYY-MM-DD'));
            current.add(1, 'day');
            continue;
        }

        if (mode === 'mark') {
            await AttendanceRecord.findOneAndUpdate(
                { user: userId, date },
                { user: userId, date, status: 'on_leave', notes: `Leave: ${leaveTypeName}` },
                { upsert: true, new: true }
            );
        } else if (mode === 'unmark' && existing && existing.status === 'on_leave') {
            await AttendanceRecord.deleteOne({ _id: existing._id });
        }

        current.add(1, 'day');
    }

    return skippedLockedDates;
};

// Aggregation feeding the admin Leave Dashboard KPI tiles + pie chart
const getLeaveDashboardStats = async ({ month, year, department } = {}) => {
    const match = {};
    if (month && year) {
        const start = moment.tz([year, month - 1, 1], 'Asia/Kolkata').startOf('month').toDate();
        const end = moment.tz([year, month - 1, 1], 'Asia/Kolkata').endOf('month').toDate();
        match.$or = [
            { startDate: { $lte: end }, endDate: { $gte: start } }
        ];
    }

    const pipeline = [
        { $match: match },
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        ...(department ? [{ $match: { 'user.department': department } }] : []),
        { $lookup: { from: 'leavetypes', localField: 'leaveType', foreignField: '_id', as: 'leaveType' } },
        { $unwind: '$leaveType' },
        {
            $facet: {
                byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
                byType: [{ $group: { _id: '$leaveType.name', count: { $sum: 1 }, color: { $first: '$leaveType.colorCode' } } }],
                byDepartment: [{ $group: { _id: '$user.department', count: { $sum: 1 } } }],
                byPaidStatus: [
                    { $match: { status: 'approved' } },
                    { $group: { _id: '$paidStatus', count: { $sum: 1 }, days: { $sum: '$totalDays' } } }
                ]
            }
        }
    ];

    const [result] = await LeaveRequest.aggregate(pipeline);
    return result;
};

module.exports = {
    calculateWorkingDays,
    checkSandwichLeave,
    getOrCreateLeaveBalance,
    checkBalanceAvailability,
    incrementPending,
    movePendingToUsed,
    revertPending,
    revertUsed,
    syncAttendanceForLeaveRange,
    getLeaveDashboardStats
};
