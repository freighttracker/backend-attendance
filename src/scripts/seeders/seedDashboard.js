const moment = require('moment');
const { User, AttendanceRecord, SalarySlip, LeaveRequest } = require('../../models');

// There is no "Dashboard" collection to seed - every number on the real
// dashboard (dashboard.controller.js, payroll.controller.js) is computed
// live from the collections the other seeders already populated. This
// script just replays the same aggregations read-only and prints them, so
// `npm run seed` ends with visible proof the numbers the UI will show are
// actually meaningful, without writing anything itself.
const MONTH = 6;
const YEAR = 2026;
const PRESENT_STATUSES = ['present', 'half_day', 'wfh'];

const inr = (n) => `Rs. ${Math.round(n || 0).toLocaleString('en-IN')}`;

const seedDashboard = async () => {
    const totalEmployees = await User.countDocuments({ role: { $ne: 'admin' } });
    const activeEmployees = await User.countDocuments({ role: { $ne: 'admin' }, isActive: true });
    const departments = await User.distinct('department', { role: { $ne: 'admin' } });

    const monthStart = moment.utc([YEAR, MONTH - 1, 1]).startOf('month').toDate();
    const monthEnd = moment.utc([YEAR, MONTH - 1, 1]).endOf('month').toDate();

    const [attendanceAgg] = await AttendanceRecord.aggregate([
        { $match: { date: { $gte: monthStart, $lte: monthEnd } } },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                workingDayRecords: { $sum: { $cond: [{ $in: ['$status', ['weekend', 'holiday']] }, 0, 1] } },
                present: { $sum: { $cond: [{ $in: ['$status', PRESENT_STATUSES] }, 1, 0] } },
                absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
                halfDay: { $sum: { $cond: [{ $eq: ['$status', 'half_day'] }, 1, 0] } },
                late: { $sum: { $cond: ['$isLate', 1, 0] } }
            }
        }
    ]);

    const [slipAgg] = await SalarySlip.aggregate([
        { $match: { month: MONTH, year: YEAR } },
        {
            $group: {
                _id: null,
                salaryGenerated: { $sum: 1 },
                payrollAmount: { $sum: '$netSalary' },
                paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$netSalary', 0] } },
                pending: { $sum: { $cond: [{ $in: ['$status', ['draft', 'generated']] }, '$netSalary', 0] } }
            }
        }
    ]);

    const pendingLeaves = await LeaveRequest.countDocuments({ status: 'pending' });
    // Percentage of *working* days (excludes weekends/holidays from the
    // denominator, same as how a real attendance-rate KPI would be framed).
    const attendancePct = attendanceAgg && attendanceAgg.workingDayRecords
        ? Math.round((attendanceAgg.present / attendanceAgg.workingDayRecords) * 100)
        : 0;

    console.log('\n================ DASHBOARD SNAPSHOT (June 2026) ================');
    console.log(`Total Employees      : ${totalEmployees} (${activeEmployees} active)`);
    console.log(`Departments          : ${departments.filter(Boolean).length}`);
    console.log(`Monthly Attendance   : ${attendancePct}% (present/half-day/wfh of working-day records, excl. weekends/holidays)`);
    console.log(`June Absences        : ${attendanceAgg ? attendanceAgg.absent : 0}`);
    console.log(`June Half Days       : ${attendanceAgg ? attendanceAgg.halfDay : 0}`);
    console.log(`June Late Arrivals   : ${attendanceAgg ? attendanceAgg.late : 0}`);
    console.log(`Pending Leave Reqs   : ${pendingLeaves}`);
    console.log(`Salary Slips Gen.    : ${slipAgg ? slipAgg.salaryGenerated : 0}`);
    console.log(`Payroll Generated    : ${inr(slipAgg ? slipAgg.payrollAmount : 0)}`);
    console.log(`Salary Paid          : ${inr(slipAgg ? slipAgg.paid : 0)}`);
    console.log(`Pending Payroll      : ${inr(slipAgg ? slipAgg.pending : 0)}`);
    console.log('==================================================================\n');

    return { totalEmployees, activeEmployees, departments, attendancePct, slipAgg };
};

module.exports = seedDashboard;
