const moment = require('moment');
const { Payroll } = require('../../models');
const { round2 } = require('../../services/payroll.service');

const MONTH = 6;
const YEAR = 2026;

const sumTotals = (slips) => slips.reduce((acc, s) => ({
    totalGrossSalary: round2(acc.totalGrossSalary + s.grossSalary),
    totalDeductions: round2(acc.totalDeductions + s.totalDeductions),
    totalBonus: round2(acc.totalBonus + s.totalBonus),
    totalReimbursements: round2(acc.totalReimbursements + s.totalReimbursement),
    totalNetSalary: round2(acc.totalNetSalary + s.netSalary)
}), { totalGrossSalary: 0, totalDeductions: 0, totalBonus: 0, totalReimbursements: 0, totalNetSalary: 0 });

// Picks a batch-level status from the mix of slip statuses in the group,
// so the Payroll run's lifecycle stays consistent with its slips - mirrors
// what cascadeSlipStatus()/approve-publish flow does in payroll.controller.js.
const pickBatchStatus = (slips) => {
    const total = slips.length;
    const paidOrPublished = slips.filter(s => ['paid', 'published'].includes(s.status)).length;
    const approvedUp = slips.filter(s => ['approved', 'published', 'paid'].includes(s.status)).length;

    if (paidOrPublished / total >= 0.7) return 'published';
    if (approvedUp / total >= 0.5) return 'approved';
    return 'processing';
};

// One Payroll run per department (the state admins actually work through -
// approve/publish/pay), plus a single company-wide run representing the
// original bulk "Generate Payroll" action that produced every slip.
const seedPayrollJune2026 = async (slips, admin) => {
    if (slips.length === 0) {
        console.log('No salary slips to build payroll runs from - skipping');
        return { payrollRuns: [] };
    }

    const byDepartment = new Map();
    slips.forEach(s => {
        const dept = s.employeeSnapshot.department || 'Unassigned';
        if (!byDepartment.has(dept)) byDepartment.set(dept, []);
        byDepartment.get(dept).push(s);
    });

    const payrollRuns = [];

    const companyTotals = sumTotals(slips);
    const companyRun = await Payroll.create({
        month: MONTH,
        year: YEAR,
        scope: 'company',
        slips: slips.map(s => s._id),
        totalEmployees: slips.length,
        processedCount: slips.length,
        failedCount: 0,
        ...companyTotals,
        status: 'completed',
        initiatedBy: admin._id
    });
    payrollRuns.push(companyRun);

    for (const [department, deptSlips] of byDepartment.entries()) {
        const totals = sumTotals(deptSlips);
        const status = pickBatchStatus(deptSlips);

        const payload = {
            month: MONTH,
            year: YEAR,
            scope: 'department',
            department,
            slips: deptSlips.map(s => s._id),
            totalEmployees: deptSlips.length,
            processedCount: deptSlips.length,
            failedCount: 0,
            ...totals,
            status,
            initiatedBy: admin._id
        };
        if (['approved', 'published'].includes(status)) {
            payload.approvedBy = admin._id;
            payload.approvedAt = moment('2026-06-29').toDate();
        }
        if (status === 'published') {
            payload.publishedBy = admin._id;
            payload.publishedAt = moment('2026-06-30').toDate();
        }

        const run = await Payroll.create(payload);
        payrollRuns.push(run);
    }

    console.log(`${payrollRuns.length} payroll runs created (1 company-wide + ${byDepartment.size} department) for June 2026`);
    return { payrollRuns };
};

module.exports = seedPayrollJune2026;
