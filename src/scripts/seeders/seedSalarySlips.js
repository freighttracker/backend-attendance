const moment = require('moment');
const { SalarySlip } = require('../../models');
const { calculateSalary, commitSlipSideEffects } = require('../../services/payroll.service');
const { weightedPick, pick, digits } = require('./utils');

const MONTH = 6;
const YEAR = 2026;

const SLIP_FIELDS = [
    'employeeSnapshot', 'salaryStructureSnapshot', 'attendanceSummary', 'earnings', 'deductions',
    'bonuses', 'reimbursements', 'loans', 'advances', 'perDaySalary', 'grossSalary',
    'totalEarnings', 'totalDeductions', 'totalBonus', 'totalReimbursement', 'netSalary'
];

// Lifecycle stage each slip ends up at - mirrors the real
// draft -> generated -> approved -> published -> paid flow the app enforces
// (see salary.controller.js), just fast-forwarded here for demo data.
const pickLifecycleStage = () => weightedPick([
    { value: 'paid', weight: 62 },
    { value: 'published', weight: 10 },
    { value: 'approved', weight: 10 },
    { value: 'generated', weight: 18 }
]);

// Generates one salary slip per active employee for June 2026, reusing the
// app's own calculateSalary() so figures always match what the real payroll
// engine would produce from the seeded attendance/leave/bonus/reimbursement
// data. PDF generation is intentionally skipped here - the download/email
// routes already lazily render the PDF on first request if pdfUrl is empty.
const seedSalarySlips = async (employees, admin) => {
    const activeEmployees = employees.filter(e => e.isActive);
    const slips = [];
    const failures = [];

    for (const emp of activeEmployees) {
        let salaryData;
        try {
            salaryData = await calculateSalary(emp._id, MONTH, YEAR);
        } catch (err) {
            failures.push({ user: emp._id, employeeCode: emp.employeeCode, reason: err.message });
            continue;
        }

        const stage = pickLifecycleStage();
        const generatedAt = moment('2026-06-28').hour(10).minute(randomMinute()).toDate();

        const payload = {
            user: emp._id,
            month: MONTH,
            year: YEAR,
            ...SLIP_FIELDS.reduce((acc, f) => ({ ...acc, [f]: salaryData[f] }), {}),
            status: stage === 'generated' ? 'generated' : stage,
            generatedBy: admin._id,
            generatedAt
        };

        if (['approved', 'published', 'paid'].includes(stage)) {
            payload.approvedBy = admin._id;
            payload.approvedAt = moment('2026-06-29').hour(11).minute(randomMinute()).toDate();
        }
        if (['published', 'paid'].includes(stage)) {
            payload.publishedBy = admin._id;
            payload.publishedAt = moment('2026-06-30').hour(15).minute(randomMinute()).toDate();
            payload.isLocked = true;
        }
        if (stage === 'paid') {
            payload.paidAt = moment('2026-07-0' + pick([1, 2, 3, 4, 5])).hour(12).minute(randomMinute()).toDate();
            payload.paymentMethod = weightedPick([{ value: 'bank_transfer', weight: 80 }, { value: 'upi', weight: 20 }]);
            payload.transactionId = `UTR${moment().format('YYYYMM')}${digits(8)}`;
        }

        const slip = await SalarySlip.create(payload);
        await commitSlipSideEffects(salaryData, slip._id);
        slips.push(slip);
    }

    if (failures.length) {
        console.warn(`Salary slip generation skipped for ${failures.length} employees:`, failures);
    }
    
    console.log(`${slips.length} salary slips generated for June 2026`);

    return { slips, failures };
};

function randomMinute() {
    return Math.floor(Math.random() * 60);
}

module.exports = seedSalarySlips;
