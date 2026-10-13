const moment = require('moment-timezone');
const User = require('../models/User');
const LeaveRequest = require('../models/LeaveRequest');
const Loan = require('../models/Loan');
const AdvanceSalary = require('../models/AdvanceSalary');
const Bonus = require('../models/Bonus');
const Reimbursement = require('../models/Reimbursement');
const SalarySlip = require('../models/SalarySlip');
const AttendanceRecord = require('../models/AttendanceRecord');
const AttendanceCorrectionRequest = require('../models/AttendanceCorrectionRequest');
const leaveService = require('./leave.service');
const { getMonthlyAttendanceSummary, computeSalaryDays, round2 } = require('./payroll.service');
const { logger } = require('../utils/logger');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

// Leave requests that can no longer happen once the employee is gone:
// anything still pending, plus approved leave starting after the last
// working day. Past/ongoing approved leave is left alone - it's history.
const findLeavesToCancel = (userId, leftAt) => LeaveRequest.find({
    user: userId,
    $or: [
        { status: 'pending' },
        { status: 'approved', startDate: { $gt: moment(leftAt).endOf('day').toDate() } }
    ]
}).populate('leaveType', 'name');

// Runs right after an employee is marked as left. Nothing here deletes
// history - open requests are closed as 'cancelled' (balances reverted the
// same way a manual cancel does) and the login session is ended. Failures
// are logged, never thrown: the exit itself has already been saved.
const closeOpenItemsOnExit = async (user, leftAt) => {
    const result = { cancelledLeaves: 0 };

    try {
        const leaves = await findLeavesToCancel(user._id, leftAt);
        for (const lr of leaves) {
            const year = new Date(lr.startDate).getFullYear();
            const leaveTypeId = lr.leaveType ? lr.leaveType._id : null;
            if (leaveTypeId) {
                if (lr.status === 'pending') {
                    await leaveService.revertPending(user._id, leaveTypeId, year, lr.totalDays);
                } else {
                    await leaveService.revertUsed(user._id, leaveTypeId, year, lr.totalDays);
                    await leaveService.syncAttendanceForLeaveRange(user._id, lr.leaveType.name, lr.startDate, lr.endDate, 'unmark');
                }
            }
            lr.status = 'cancelled';
            await lr.save();
            result.cancelledLeaves += 1;
        }
    } catch (error) {
        logger.error(`Exit cleanup (leaves) failed for ${user.email}:`, error);
    }

    try {
        // Ends any session that could otherwise be refreshed after exit.
        await User.updateOne({ _id: user._id }, { $unset: { refreshToken: 1 } });
    } catch (error) {
        logger.error(`Exit cleanup (session) failed for ${user.email}:`, error);
    }

    return result;
};

// Everything an admin needs to settle before/after an employee leaves:
// money still owed either way, open requests, and the final month's pay
// status. Read-only - also used as a preview before marking someone left.
const buildExitSummary = async (user, previewLeavingDate = null) => {
    const hasLeft = !user.isActive && !!user.leftAt;
    const refDate = hasLeft ? user.leftAt : (previewLeavingDate || new Date());
    // leftAt is a date-only value stored at UTC midnight; a preview/"now"
    // instant is read in the office timezone.
    const ref = hasLeft || previewLeavingDate ? moment.utc(refDate) : moment.tz(refDate, TZ);
    const month = ref.month() + 1;
    const year = ref.year();

    const [loans, advances, leavesToCancel, pendingCorrections, pendingOvertime, bonuses, reimbursements, unpaidSlips, finalSlip, attendance] = await Promise.all([
        Loan.find({ user: user._id, status: 'active', remainingBalance: { $gt: 0 } }).select('amount emiAmount remainingBalance'),
        AdvanceSalary.find({ user: user._id, status: 'active', remainingBalance: { $gt: 0 } }).select('amount deductionPerMonth remainingBalance'),
        findLeavesToCancel(user._id, refDate),
        AttendanceCorrectionRequest.countDocuments({ user: user._id, status: 'pending' }),
        AttendanceRecord.find({ user: user._id, overtimeHours: { $gt: 0 }, overtimeStatus: { $nin: ['approved', 'rejected'] } }).select('overtimeHours'),
        Bonus.find({ user: user._id, status: { $in: ['pending', 'approved'] }, isApplied: false }).select('amount status'),
        Reimbursement.find({ user: user._id, status: { $in: ['pending', 'approved'] }, isApplied: false }).select('amount status'),
        SalarySlip.find({ user: user._id, status: { $ne: 'paid' } }).select('month year netSalary status').sort({ year: 1, month: 1 }),
        SalarySlip.findOne({ user: user._id, month, year }).select('month year netSalary status'),
        getMonthlyAttendanceSummary(user._id, month, year)
    ]);

    const sum = (docs, key) => round2(docs.reduce((acc, d) => acc + (d[key] || 0), 0));
    const joining = user.joiningDate ? moment.utc(user.joiningDate) : null;

    return {
        employee: {
            id: user._id,
            employeeCode: user.employeeCode,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
            department: user.department || null,
            designation: user.designation || null,
            joiningDate: user.joiningDate || null
        },
        hasLeft,
        lastWorkingDay: hasLeft ? user.leftAt : null,
        exitType: user.exitType || null,
        reason: user.leftReason || null,
        tenureMonths: joining ? Math.max(ref.diff(joining, 'months'), 0) : null,
        // Money the employee still owes the company.
        recoverable: {
            loanBalance: sum(loans, 'remainingBalance'),
            loanCount: loans.length,
            advanceBalance: sum(advances, 'remainingBalance'),
            advanceCount: advances.length,
            total: round2(sum(loans, 'remainingBalance') + sum(advances, 'remainingBalance'))
        },
        // Money the company still owes the employee, outside regular salary.
        payable: {
            approvedBonuses: sum(bonuses.filter((b) => b.status === 'approved'), 'amount'),
            approvedReimbursements: sum(reimbursements.filter((r) => r.status === 'approved'), 'amount'),
            pendingBonusCount: bonuses.filter((b) => b.status === 'pending').length,
            pendingReimbursementCount: reimbursements.filter((r) => r.status === 'pending').length
        },
        openItems: {
            // Before exit: what will be cancelled. After exit: normally 0.
            leaveRequests: leavesToCancel.length,
            correctionRequests: pendingCorrections,
            overtimeDays: pendingOvertime.length,
            overtimeHours: sum(pendingOvertime, 'overtimeHours')
        },
        finalMonth: {
            month,
            year,
            daysInMonth: attendance.daysInMonth,
            // Only meaningful once the last working day is fixed.
            payableDays: hasLeft ? computeSalaryDays(attendance) : null,
            daysAfterLastWorkingDay: attendance.notEmployedDays || 0,
            slip: finalSlip ? { id: finalSlip._id, status: finalSlip.status, netSalary: finalSlip.netSalary } : null
        },
        unpaidSlips: unpaidSlips.map((s) => ({ id: s._id, month: s.month, year: s.year, netSalary: s.netSalary, status: s.status }))
    };
};

module.exports = { closeOpenItemsOnExit, buildExitSummary };
