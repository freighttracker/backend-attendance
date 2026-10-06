const moment = require('moment-timezone');
const User = require('../models/User');
const SalaryStructure = require('../models/SalaryStructure');
const SalarySlip = require('../models/SalarySlip');
const AttendanceRecord = require('../models/AttendanceRecord');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const WeekendConfig = require('../models/WeekendConfig');
const SystemSetting = require('../models/SystemSetting');
const Bonus = require('../models/Bonus');
const Reimbursement = require('../models/Reimbursement');
const Loan = require('../models/Loan');
const AdvanceSalary = require('../models/AdvanceSalary');
const { markMissedCheckoutsAsHalfDay } = require('./attendance.service');
const { logger } = require('../utils/logger');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Admin-configurable global payroll settings (stored as SystemSetting docs so
// they use the same admin panel plumbing as every other setting in the app).
// ---------------------------------------------------------------------------
const DEFAULT_LATE_POLICY = [
    { lateCount: 3, deductionDays: 0.5 },
    { lateCount: 6, deductionDays: 1 }
];

const getLatePolicy = async () => {
    const setting = await SystemSetting.findOne({ settingKey: 'payroll_late_policy' });
    if (!setting || !Array.isArray(setting.settingValue) || setting.settingValue.length === 0) {
        return DEFAULT_LATE_POLICY;
    }
    return setting.settingValue;
};

// Working days before this date with no attendance record are treated as a
// normal present/paid day rather than absence (LOP) - protects payroll for
// the period before the company actually started using attendance tracking,
// where "no record" means "not captured yet", not "didn't show up".
// null/unset means every past working day without a record is LOP, as before.
const getAttendanceTrackingStartDate = async () => {
    const setting = await SystemSetting.findOne({ settingKey: 'attendance_tracking_start_date' });
    if (!setting || !setting.settingValue) return null;
    const parsed = moment.tz(setting.settingValue, TZ).startOf('day');
    return parsed.isValid() ? parsed : null;
};

const getCompanyProfile = async () => {
    const keys = ['company_name', 'company_address', 'company_logo', 'company_pan', 'company_bank_name'];
    const settings = await SystemSetting.find({ settingKey: { $in: keys } });
    const map = {};
    settings.forEach(s => { map[s.settingKey] = s.settingValue; });
    return {
        name: map.company_name || process.env.COMPANY_NAME || 'Your Company',
        address: map.company_address || process.env.COMPANY_ADDRESS || '',
        logoUrl: map.company_logo || null,
        pan: map.company_pan || '',
        bankName: map.company_bank_name || ''
    };
};

// ---------------------------------------------------------------------------
// Component resolution - never hardcode a percentage, always resolve from
// whatever the admin configured on the employee's salary structure.
// ---------------------------------------------------------------------------
const resolveComponent = (component, base) => {
    if (!component || component.isEnabled === false) return 0;
    if (component.calculationType === 'percentage') {
        const baseAmount = base[component.baseComponent] || 0;
        return (baseAmount * (component.value || 0)) / 100;
    }
    return component.value || 0;
};

// Picks the salary structure version that was actually in force for the
// given month/year, so past payroll can always be recalculated correctly
// even after the employee has since been given a revision.
const getEffectiveStructure = async (userId, month, year) => {
    const structure = await SalaryStructure.findOne({ user: userId, isActive: true });
    if (!structure) return null;

    const monthStart = moment.tz([year, month - 1, 1], TZ).startOf('day');
    const monthEnd = moment(monthStart).endOf('month');

    const versions = [
        {
            monthlyGrossSalary: structure.monthlyGrossSalary,
            annualCTC: structure.annualCTC,
            earnings: structure.earnings,
            deductions: structure.deductions,
            overtime: structure.overtime,
            effectiveFrom: structure.effectiveFrom,
            effectiveTo: null
        },
        ...structure.revisionHistory.map(r => ({
            monthlyGrossSalary: r.monthlyGrossSalary,
            annualCTC: r.annualCTC,
            earnings: r.earnings,
            deductions: r.deductions,
            overtime: r.overtime,
            effectiveFrom: r.effectiveFrom,
            effectiveTo: r.effectiveTo
        }))
    ];

    const matches = versions.filter(v => {
        const from = moment(v.effectiveFrom);
        const to = v.effectiveTo ? moment(v.effectiveTo) : null;
        return from.isSameOrBefore(monthEnd) && (!to || to.isSameOrAfter(monthStart));
    });

    if (matches.length === 0) return null;
    // Prefer the most recent matching version
    matches.sort((a, b) => moment(b.effectiveFrom).valueOf() - moment(a.effectiveFrom).valueOf());
    return { structureId: structure._id, ...matches[0] };
};

// For a 'partial' leave request, allocates the admin's paidDays count across
// the request's own working days (chronological order, skipping weekends/
// holidays the same way calculateWorkingDays does) so a leave spanning a
// month boundary still gets a consistent split no matter which month is
// being paid. Queries holidays over the request's own full range rather than
// reusing the caller's month-scoped holiday set, since that range can extend
// outside the month being paid.
const buildPartialLeavePaidDateSet = async (leaveRequest, weekendDaySet) => {
    const start = moment(leaveRequest.startDate).startOf('day');
    const end = moment(leaveRequest.endDate).startOf('day');
    const rangeHolidays = await Holiday.find({
        isActive: true,
        date: { $gte: start.toDate(), $lte: end.toDate() }
    });
    const holidayDateSet = new Set(rangeHolidays.map(h => moment.tz(h.date, TZ).format('YYYY-MM-DD')));

    const paidDateSet = new Set();
    let remainingPaidDays = leaveRequest.paidDays || 0;
    const cursor = start.clone();
    while (cursor.isSameOrBefore(end, 'day')) {
        const dateStr = cursor.format('YYYY-MM-DD');
        const dayOfWeek = cursor.format('dddd').toLowerCase();
        if (!weekendDaySet.has(dayOfWeek) && !holidayDateSet.has(dateStr)) {
            if (remainingPaidDays > 0) {
                paidDateSet.add(dateStr);
                remainingPaidDays -= 1;
            }
        }
        cursor.add(1, 'day');
    }
    return paidDateSet;
};

// ---------------------------------------------------------------------------
// Attendance + leave reconciliation for the month, day by day, so weekends,
// holidays, approved paid/unpaid leave and unapproved absence are never
// double counted against each other.
// ---------------------------------------------------------------------------

const getMonthlyAttendanceSummary = async (userId, month, year) => {
    await markMissedCheckoutsAsHalfDay(userId);

    const monthStart = moment.tz([year, month - 1, 1], TZ).startOf('day');
    const monthEnd = moment(monthStart).endOf('month');
    const today = moment.tz(TZ).endOf('day');
    const daysInMonth = monthStart.daysInMonth();

    const [weekendConfigs, holidays, leaveRequests, attendanceRecords, trackingStartDate] = await Promise.all([
        WeekendConfig.find({ isWeekend: true, isActive: true }),
        Holiday.find({ isActive: true, date: { $gte: monthStart.toDate(), $lte: monthEnd.toDate() } }),
        LeaveRequest.find({
            user: userId,
            status: 'approved',
            startDate: { $lte: monthEnd.toDate() },
            endDate: { $gte: monthStart.toDate() }
        }).populate('leaveType', 'name'),
        
        AttendanceRecord.find({
            user: userId,
            date: { $gte: monthStart.toDate(), $lte: monthEnd.toDate() }
        }),
        getAttendanceTrackingStartDate()
    ]);

    const weekendDaySet = new Set(
        weekendConfigs.length > 0
            ? weekendConfigs.map(w => w.dayOfWeek)
            : ['saturday', 'sunday']
    );
    const holidayDateSet = new Set(holidays.map(h => moment.tz(h.date, TZ).format('YYYY-MM-DD')));

    const attendanceByDate = new Map();
    attendanceRecords.forEach(r => attendanceByDate.set(moment.tz(r.date, TZ).format('YYYY-MM-DD'), r));

    // Expand each approved leave request into per-day paid/unpaid flags.
    // Paid/unpaid is decided by the admin at approval time
    // (LeaveRequest.paidStatus), independent of the leave type's own
    // default. A 'partial' approval only carries an aggregate paidDays
    // count, so it needs a chronological per-day allocation to know which
    // specific days in this month were the paid ones.
    const leaveByDate = new Map();
    for (const lr of leaveRequests) {
        const start = moment.max(moment.tz(lr.startDate, TZ), monthStart);
        const end = moment.min(moment.tz(lr.endDate, TZ), monthEnd);

        const partialPaidDateSet = lr.paidStatus === 'partial'
            ? await buildPartialLeavePaidDateSet(lr, weekendDaySet)
            : null;

        const cursor = start.clone();
        while (cursor.isSameOrBefore(end, 'day')) {
            const dateStr = cursor.format('YYYY-MM-DD');
            leaveByDate.set(dateStr, {
                isPaid: partialPaidDateSet ? partialPaidDateSet.has(dateStr) : lr.paidStatus === 'paid',
                leaveTypeName: lr.leaveType ? lr.leaveType.name : 'Leave'
            });
            cursor.add(1, 'day');
        }
    }

    const summary = {
        daysInMonth,
        workingDays: 0,
        presentDays: 0,
        absentDays: 0,
        halfDays: 0,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        weeklyOffs: 0,
        holidays: 0,
        lateCount: 0,
        earlyLeaveCount: 0,
        overtimeHours: 0
    };

    const cursor = monthStart.clone();
    while (cursor.isSameOrBefore(monthEnd, 'day')) {
        const dateStr = cursor.format('YYYY-MM-DD');
        const dayOfWeek = cursor.format('dddd').toLowerCase();

        if (weekendDaySet.has(dayOfWeek)) {
            summary.weeklyOffs += 1;
            cursor.add(1, 'day');
            continue;
        }
        if (holidayDateSet.has(dateStr)) {
            summary.holidays += 1;
            cursor.add(1, 'day');
            continue;
        }

        const record = attendanceByDate.get(dateStr);

        // Admin forced this working day to Weekend/Holiday (via a correction)
        // - treat it as a paid day off, same as the configured ones above.
        if (record && record.status === 'weekend') {
            summary.weeklyOffs += 1;
            cursor.add(1, 'day');
            continue;
        }
        if (record && record.status === 'holiday') {
            summary.holidays += 1;
            cursor.add(1, 'day');
            continue;
        }

        summary.workingDays += 1;
        const leave = leaveByDate.get(dateStr);

        if (record) {
            summary.lateCount += record.isLate ? 1 : 0;
            summary.earlyLeaveCount += record.isEarlyLeave ? 1 : 0;
            summary.overtimeHours += record.overtimeHours || 0;

            if (record.status === 'present' || record.status === 'wfh') {
                summary.presentDays += 1;
            } else if (record.status === 'half_day') {
                summary.halfDays += 1;
            } else if (record.status === 'on_leave') {
                if (leave && leave.isPaid) summary.paidLeaveDays += 1;
                else summary.unpaidLeaveDays += 1;
            } else if (record.status === 'absent') {
                if (leave && leave.isPaid) summary.paidLeaveDays += 1;
                else { summary.absentDays += 1; summary.unpaidLeaveDays += 1; }
            }
        } else if (leave) {
            if (leave.isPaid) summary.paidLeaveDays += 1;
            else summary.unpaidLeaveDays += 1;
        } else if (trackingStartDate && cursor.isBefore(trackingStartDate)) {
            // Before attendance tracking started company-wide - "no record"
            // here means "not captured yet", not absence. Pay it normally.
            summary.presentDays += 1;
        } else if (cursor.isBefore(today)) {
            // Working day, in the past (on/after tracking start), no record
            // and no approved leave -> LOP
            summary.absentDays += 1;
            summary.unpaidLeaveDays += 1;
        }

        cursor.add(1, 'day');
    }

    return summary;
};

// ---------------------------------------------------------------------------
// Payable "salary days" for a month - present/holiday/weekly-off count in

// full, half days count as half, unpaid leave and absence count as zero.
// This is the same accounting calculateSalary() already applies via its
// per-day-rate deduction math below; exposed as a named value here purely
// for reporting/display so the attendance report never has to duplicate or
// drift from what payroll actually pays.
// ---------------------------------------------------------------------------
const computeSalaryDays = (attendance) => round2(
    (attendance.presentDays || 0) +
    (attendance.halfDays || 0) * 0.5 +
    (attendance.paidLeaveDays || 0) +
    (attendance.holidays || 0) +
    (attendance.weeklyOffs || 0)
);

// ---------------------------------------------------------------------------
// Ad-hoc earnings: approved, not-yet-applied bonuses/reimbursements for the
// month. "Applied" bookkeeping happens in applyAdHocEarnings() below.
// ---------------------------------------------------------------------------
const getPendingBonuses = (userId, month, year) =>
    Bonus.find({ user: userId, month, year, status: 'approved', isApplied: false });

const getPendingReimbursements = (userId, month, year) =>
    Reimbursement.find({ user: userId, month, year, status: 'approved', isApplied: false });

// Loans/advances: idempotent per month/year - if a deduction was already
// recorded for this month (e.g. on a previous generate), reuse it verbatim
// instead of deducting the balance again on regenerate.
const getLoanAndAdvanceDeductions = async (userId, month, year) => {
    const [loans, advances] = await Promise.all([
        Loan.find({ user: userId, status: 'active' }),
        AdvanceSalary.find({ user: userId, status: 'active' })
    ]);

    const loanLines = loans.map(loan => {
        const existing = loan.deductionsApplied.find(d => d.month === month && d.year === year);
        const amount = existing ? existing.amount : round2(Math.min(loan.emiAmount, loan.remainingBalance));
        return { doc: loan, amount, alreadyApplied: !!existing };
    }).filter(l => l.amount > 0);

    const advanceLines = advances.map(advance => {
        const existing = advance.deductionsApplied.find(d => d.month === month && d.year === year);
        const amount = existing ? existing.amount : round2(Math.min(advance.deductionPerMonth, advance.remainingBalance));
        return { doc: advance, amount, alreadyApplied: !!existing };
    }).filter(a => a.amount > 0);

    return { loanLines, advanceLines };
};

// ---------------------------------------------------------------------------
// Main calculation - pure/read-only. Does not mutate Bonus/Reimbursement/
// Loan/AdvanceSalary documents; that happens in commitSlipSideEffects()
// once the caller has decided to actually persist the slip.
// ---------------------------------------------------------------------------
const calculateSalary = async (userId, month, year) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('Employee not found');

    const structure = await getEffectiveStructure(userId, month, year);
    if (!structure) throw new Error(`No active salary structure found for ${user.employeeCode} covering ${month}/${year}`);

    const attendance = await getMonthlyAttendanceSummary(userId, month, year);
    const latePolicy = await getLatePolicy();
    const [pendingBonuses, pendingReimbursements, { loanLines, advanceLines }] = await Promise.all([
        getPendingBonuses(userId, month, year),
        getPendingReimbursements(userId, month, year),
        getLoanAndAdvanceDeductions(userId, month, year)
    ]);

    const monthlyGrossSalary = structure.monthlyGrossSalary;
    const base = { monthlyGrossSalary };
    const basicSalary = resolveComponent(structure.earnings.basicSalary, base);
    base.basicSalary = basicSalary;

    const earnings = [];
    const pushEarning = (key, name, amount) => earnings.push({ key, name, amount: round2(amount) });

    pushEarning('basicSalary', 'Basic Salary', basicSalary);
    pushEarning('hra', 'HRA', resolveComponent(structure.earnings.hra, base));
    pushEarning('specialAllowance', 'Special Allowance', resolveComponent(structure.earnings.specialAllowance, base));
    pushEarning('conveyanceAllowance', 'Conveyance Allowance', resolveComponent(structure.earnings.conveyanceAllowance, base));
    pushEarning('medicalAllowance', 'Medical Allowance', resolveComponent(structure.earnings.medicalAllowance, base));
    pushEarning('foodAllowance', 'Food Allowance', resolveComponent(structure.earnings.foodAllowance, base));
    pushEarning('internetAllowance', 'Internet/Mobile Allowance', resolveComponent(structure.earnings.internetAllowance, base));

    // "Gross salary" is the structure's own configured monthly gross, not a
    // subtotal of whichever earnings happened to be pushed so far - using the
    // partial subtotal here meant performance incentive/bonus were silently
    // excluded from the per-day LOP rate below (paid in full no matter how
    // many days were unpaid leave), and it drifted from monthlyGrossSalary
    // as soon as those components were nonzero.
    const grossSalary = round2(monthlyGrossSalary);

    pushEarning('performanceIncentive', 'Performance Incentive', resolveComponent(structure.earnings.performanceIncentive, base));

    const structureBonus = resolveComponent(structure.earnings.bonus, base);
    const adHocBonusTotal = pendingBonuses.reduce((sum, b) => sum + b.amount, 0);
    pushEarning('bonus', 'Bonus', structureBonus + adHocBonusTotal);

    (structure.earnings.otherAllowances || []).forEach((item, idx) => {
        if (item.isEnabled === false) return;
        pushEarning(`otherAllowance_${idx}`, item.name, resolveComponent(item, base));
    });

    // Overtime
    let overtimeAmount = 0;
    if (structure.overtime && structure.overtime.isEnabled && attendance.overtimeHours > 0) {
        let hourlyRate = 0;
        if (structure.overtime.rateType === 'fixedHourlyRate') {
            hourlyRate = structure.overtime.hourlyRate || 0;
        } else {
            const hourlyBasic = basicSalary / ((attendance.workingDays || 26) * 8);
            hourlyRate = hourlyBasic * (structure.overtime.rateMultiplier || 1.5);
        }
        overtimeAmount = attendance.overtimeHours * hourlyRate;
        pushEarning('overtime', 'Overtime', overtimeAmount);
    }

    const reimbursementTotal = pendingReimbursements.reduce((sum, r) => sum + r.amount, 0);
    if (reimbursementTotal > 0) pushEarning('reimbursement', 'Reimbursements', reimbursementTotal);

    const totalEarnings = round2(earnings.reduce((sum, e) => sum + e.amount, 0));

    // Deductions - structure-configured
    const deductions = [];
    const pushDeduction = (key, name, amount) => { if (amount) deductions.push({ key, name, amount: round2(amount) }); };

    pushDeduction('pf', 'Provident Fund (PF)', resolveComponent(structure.deductions.pf, base));
    pushDeduction('professionalTax', 'Professional Tax', resolveComponent(structure.deductions.professionalTax, base));
    pushDeduction('tds', 'Income Tax (TDS)', resolveComponent(structure.deductions.tds, base));
    pushDeduction('esic', 'ESIC', resolveComponent(structure.deductions.esic, base));
    (structure.deductions.otherDeductions || []).forEach((item, idx) => {
        if (item.isEnabled === false) return;
        pushDeduction(`otherDeduction_${idx}`, item.name, resolveComponent(item, base));
    });

    // Attendance-driven deductions. Per-day rate is gross salary spread over
    // every calendar day of the month (e.g. 30000 / 31 = 967.74), not just
    // working days - weekends/holidays are already "free" by virtue of never
    // being counted as unpaid leave/absence, they don't need to be excluded
    // from the denominator too (that would double-count their benefit and
    // inflate the per-day rate).
    const perDaySalary = attendance.daysInMonth > 0 ? grossSalary / attendance.daysInMonth : 0;
    const leaveDeductionAmount = perDaySalary * attendance.unpaidLeaveDays;
    pushDeduction('leaveDeduction', 'Leave Deduction (LOP)', leaveDeductionAmount);

    const halfDayDeductionAmount = (perDaySalary / 2) * attendance.halfDays;
    pushDeduction('halfDayDeduction', 'Half Day Deduction', halfDayDeductionAmount);

    const lateTier = [...latePolicy]
        .sort((a, b) => a.lateCount - b.lateCount)
        .filter(tier => attendance.lateCount >= tier.lateCount)
        .pop();
    const lateDeductionUnits = lateTier ? lateTier.deductionDays : 0;
    const lateDeductionAmount = perDaySalary * lateDeductionUnits;
    pushDeduction('lateDeduction', 'Late Deduction', lateDeductionAmount);

    const loanTotal = loanLines.reduce((sum, l) => sum + l.amount, 0);
    pushDeduction('loanEmi', 'Loan EMI', loanTotal);

    const advanceTotal = advanceLines.reduce((sum, a) => sum + a.amount, 0);
    pushDeduction('advanceDeduction', 'Advance Salary', advanceTotal);

    const totalDeductions = round2(deductions.reduce((sum, d) => sum + d.amount, 0));
    const totalBonus = round2(adHocBonusTotal);
    const totalReimbursement = round2(reimbursementTotal);
    const netSalary = round2(totalEarnings - totalDeductions);

    return {
        user: userId,
        company: user.company || null,
        subCompany: user.subCompany || null,
        month,
        year,
        employeeSnapshot: {
            employeeCode: user.employeeCode,
            fullName: user.fullName,
            email: user.email,
            department: user.department,
            designation: user.designation,
            panNumber: user.panNumber,
            joiningDate: user.joiningDate,
            bankDetails: user.bankDetails
        },
        salaryStructureSnapshot: {
            monthlyGrossSalary: structure.monthlyGrossSalary,
            annualCTC: structure.annualCTC,
            effectiveFrom: structure.effectiveFrom
        },
        attendanceSummary: {
            ...attendance,
            lateDeductionUnits
        },
        earnings,
        deductions,
        bonuses: pendingBonuses.map(b => ({ refId: b._id, type: b.bonusType, amount: b.amount })),
        reimbursements: pendingReimbursements.map(r => ({ refId: r._id, type: r.category, amount: r.amount })),
        loans: loanLines.map(l => ({ refId: l.doc._id, type: 'loan', amount: l.amount })),
        advances: advanceLines.map(a => ({ refId: a.doc._id, type: 'advance', amount: a.amount })),
        perDaySalary: round2(perDaySalary),
        grossSalary,
        totalEarnings,
        totalDeductions,
        totalBonus,
        totalReimbursement,
        netSalary,
        _pending: { pendingBonuses, pendingReimbursements, loanLines, advanceLines }
    };
};

// ---------------------------------------------------------------------------
// Side effects applied only once a slip is actually persisted: mark bonuses/
// reimbursements as applied, and record loan/advance EMI deductions.
// Idempotent - safe to call again on regenerate as long as the underlying
// docs are re-fetched fresh (getPendingBonuses/getLoanAndAdvanceDeductions
// already exclude anything already applied/recorded for this month).
// ---------------------------------------------------------------------------
const commitSlipSideEffects = async (salaryData, salarySlipId, session) => {

    const { pendingBonuses, pendingReimbursements, loanLines, advanceLines } = salaryData._pending;

    await Promise.all(pendingBonuses.map(b => {

        b.isApplied = true;
        b.salarySlip = salarySlipId;
        return b.save({ session });
        
    }));

    await Promise.all(pendingReimbursements.map(r => {
        r.isApplied = true;
        r.salarySlip = salarySlipId;
        return r.save({ session });
    }));

    await Promise.all(loanLines.filter(l => !l.alreadyApplied).map(l => {

        const loan = l.doc;
        loan.deductionsApplied.push({ month: salaryData.month, year: salaryData.year, amount: l.amount, salarySlip: salarySlipId });
        loan.remainingBalance = round2(loan.remainingBalance - l.amount);
        if (loan.remainingBalance <= 0) loan.status = 'closed';
        return loan.save({ session });

    }));

    await Promise.all(advanceLines.filter(a => !a.alreadyApplied).map(a => {

        const advance = a.doc;
        advance.deductionsApplied.push({ month: salaryData.month, year: salaryData.year, amount: a.amount, salarySlip: salarySlipId });
        advance.remainingBalance = round2(advance.remainingBalance - a.amount);
        if (advance.remainingBalance <= 0) advance.status = 'closed';
        return advance.save({ session });
        
    }));
};

// Releases bonuses/reimbursements tied to a slip that is being regenerated,
// so calculateSalary() can freely re-pick them up (or drop ones no longer
// approved). Loan/advance deductionsApplied entries are intentionally left
// alone - getLoanAndAdvanceDeductions() already reuses them idempotently.
const releaseSlipSideEffects = async (salarySlip, session) => {

    await Promise.all([
        Bonus.updateMany({ salarySlip: salarySlip._id }, { isApplied: false, salarySlip: null }, { session }),
        Reimbursement.updateMany({ salarySlip: salarySlip._id }, { isApplied: false, salarySlip: null }, { session })
    ]);

};

module.exports = {
    round2,
    getLatePolicy,
    getAttendanceTrackingStartDate,
    getCompanyProfile,
    getEffectiveStructure,
    getMonthlyAttendanceSummary,
    computeSalaryDays,
    calculateSalary,
    commitSlipSideEffects,
    releaseSlipSideEffects
};
