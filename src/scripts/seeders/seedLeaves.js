const moment = require('moment');
const { LeaveType, LeaveBalance, LeaveRequest } = require('../../models');
const { pick, chance } = require('./utils');

const LEAVE_TYPE_SEED = [
    { name: 'Casual Leave', code: 'CL', description: 'Casual leave for personal matters', defaultDaysPerYear: 12, isCarryForward: false, isPaid: true, colorCode: '#3B82F6' },
    { name: 'Sick Leave', code: 'SL', description: 'Medical leave for health issues', defaultDaysPerYear: 10, isCarryForward: false, isPaid: true, colorCode: '#EF4444' },
    { name: 'Earned Leave', code: 'EL', description: 'Earned/Privilege leave', defaultDaysPerYear: 15, isCarryForward: true, maxCarryForwardDays: 30, isPaid: true, colorCode: '#10B981' },
    { name: 'Maternity Leave', code: 'ML', description: 'Maternity leave for female employees', defaultDaysPerYear: 180, isCarryForward: false, isPaid: true, colorCode: '#F59E0B' },
    { name: 'Paternity Leave', code: 'PL', description: 'Paternity leave for male employees', defaultDaysPerYear: 15, isCarryForward: false, isPaid: true, colorCode: '#8B5CF6' },
    { name: 'Loss of Pay', code: 'LOP', description: 'Unpaid leave', defaultDaysPerYear: 0, isCarryForward: false, isPaid: false, colorCode: '#6B7280' }
];

const BALANCE_TRACKED_CODES = ['CL', 'SL', 'EL'];
const REASONS = {
    CL: ['Personal work', 'Family function', 'Home relocation', 'Personal emergency'],
    SL: ['Fever and body ache', 'Medical checkup', 'Not feeling well', 'Doctor appointment'],
    EL: ['Family vacation', 'Wedding in family', 'Planned trip', 'Festival travel'],
    ML: ['Maternity leave'],
    PL: ['Paternity leave - newborn care'],
    LOP: ['Extended personal leave', 'Leave without pay - personal reasons']
};

// Nudges a moment date forward off a weekend and returns a clone.
const toWeekday = (m) => {
    const clone = m.clone();
    const day = clone.day();
    if (day === 0) clone.add(1, 'day');
    else if (day === 6) clone.add(2, 'day');
    return clone;
};

const createLeave = async ({ user, leaveType, start, days, status, admin, reasonPool, rejectionReason }) => {
    const startDate = toWeekday(start);
    const endDate = startDate.clone().add(days - 1, 'days');
    const payload = {
        user: user._id,
        leaveType: leaveType._id,
        startDate: startDate.toDate(),
        endDate: endDate.toDate(),
        totalDays: days,
        reason: pick(reasonPool),
        status
    };
    if (status === 'approved') {
        payload.approvedBy = admin._id;
        payload.approvedAt = new Date();
    } else if (status === 'rejected') {
        payload.approvedBy = admin._id;
        payload.approvedAt = new Date();
        payload.rejectionReason = rejectionReason;
    }
    return LeaveRequest.create(payload);
};

const seedLeaves = async (employees, admin) => {
    await LeaveType.insertMany(LEAVE_TYPE_SEED);
    const leaveTypes = await LeaveType.find({});
    const byCode = {};
    leaveTypes.forEach(lt => { byCode[lt.code] = lt; });
    console.log(`${leaveTypes.length} leave types created`);

    const activeEmployees = employees.filter(e => e.isActive);
    const currentYear = 2026;

    // Leave balances for the tracked paid types, for every active employee.
    for (const emp of activeEmployees) {
        for (const code of BALANCE_TRACKED_CODES) {
            await LeaveBalance.create({
                user: emp._id,
                leaveType: byCode[code]._id,
                year: currentYear,
                totalDays: byCode[code].defaultDaysPerYear,
                usedDays: 0,
                pendingDays: 0,
                carryForwardDays: 0
            });
        }
    }
    console.log(`Leave balances created for ${activeEmployees.length} employees`);

    let approvedPaid = 0, approvedUnpaid = 0, pending = 0, rejected = 0;

    // Approved paid leave blocks in June 2026 (~25% of active employees).
    for (const emp of activeEmployees) {
        if (!chance(0.25)) continue;
        const code = pick(['CL', 'SL', 'EL']);
        const leaveType = byCode[code];
        const days = code === 'EL' ? (chance(0.3) ? 3 : 2) : (chance(0.5) ? 2 : 1);
        const startDay = 2 + Math.floor(Math.random() * 20); // keep block inside June
        const leave = await createLeave({
            user: emp, leaveType, start: moment('2026-06-01').date(startDay),
            days, status: 'approved', admin, reasonPool: REASONS[code]
        });
        await LeaveBalance.findOneAndUpdate(
            { user: emp._id, leaveType: leaveType._id, year: currentYear },
            { $inc: { usedDays: leave.totalDays } }
        );
        approvedPaid += 1;
    }

    // Approved unpaid (Loss of Pay) blocks in June 2026 (~12% of active employees).
    for (const emp of activeEmployees) {
        if (!chance(0.12)) continue;
        const leaveType = byCode.LOP;
        const days = chance(0.6) ? 1 : 2;
        const startDay = 2 + Math.floor(Math.random() * 20);
        await createLeave({
            user: emp, leaveType, start: moment('2026-06-01').date(startDay),
            days, status: 'approved', admin, reasonPool: REASONS.LOP
        });
        approvedUnpaid += 1;
    }

    // A couple of Maternity/Paternity leave requests for eligible employees.
    const femaleEmployees = activeEmployees.filter(e => e.gender === 'female');
    const maleEmployees = activeEmployees.filter(e => e.gender === 'male');
    if (femaleEmployees.length) {
        const emp = pick(femaleEmployees);
        const leave = await createLeave({
            user: emp, leaveType: byCode.ML, start: moment('2026-06-01'),
            days: 26, status: 'approved', admin, reasonPool: REASONS.ML
        });
        await LeaveBalance.findOneAndUpdate(
            { user: emp._id, leaveType: byCode.ML._id, year: currentYear },
            { totalDays: 180, usedDays: leave.totalDays, pendingDays: 0, carryForwardDays: 0 },
            { upsert: true }
        );
        approvedPaid += 1;
    }
    if (maleEmployees.length) {
        const emp = pick(maleEmployees);
        const leave = await createLeave({
            user: emp, leaveType: byCode.PL, start: moment('2026-06-08'),
            days: 5, status: 'approved', admin, reasonPool: REASONS.PL
        });
        await LeaveBalance.findOneAndUpdate(
            { user: emp._id, leaveType: byCode.PL._id, year: currentYear },
            { totalDays: 15, usedDays: leave.totalDays, pendingDays: 0, carryForwardDays: 0 },
            { upsert: true }
        );
        approvedPaid += 1;
    }

    // Pending leave requests for upcoming dates (awaiting admin approval today).
    for (const emp of activeEmployees) {
        if (!chance(0.1)) continue;
        const code = pick(['CL', 'SL', 'EL']);
        const leaveType = byCode[code];
        const days = chance(0.5) ? 1 : 2;
        const startDay = 1 + Math.floor(Math.random() * 20);
        const leave = await createLeave({
            user: emp, leaveType, start: moment('2026-08-01').date(startDay),
            days, status: 'pending', admin, reasonPool: REASONS[code]
        });
        await LeaveBalance.findOneAndUpdate(
            { user: emp._id, leaveType: leaveType._id, year: currentYear },
            { $inc: { pendingDays: leave.totalDays } }
        );
        pending += 1;
    }

    // Rejected leave requests, for report/status diversity.
    for (const emp of activeEmployees) {
        if (!chance(0.05)) continue;
        const code = pick(['CL', 'EL']);
        const leaveType = byCode[code];
        const startDay = 1 + Math.floor(Math.random() * 20);
        await createLeave({
            user: emp, leaveType, start: moment('2026-08-01').date(startDay),
            days: 1, status: 'rejected', admin, reasonPool: REASONS[code],
            rejectionReason: pick(['Insufficient staffing during that period', 'Critical project deadline', 'Team already short-staffed'])
        });
        rejected += 1;
    }

    console.log(`Leave requests created - approved paid: ${approvedPaid}, approved unpaid: ${approvedUnpaid}, pending: ${pending}, rejected: ${rejected}`);

    return { leaveTypes, byCode };
};

module.exports = seedLeaves;
