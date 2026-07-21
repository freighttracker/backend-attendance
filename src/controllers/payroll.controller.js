const mongoose = require('mongoose');
const moment = require('moment-timezone');
const XLSX = require('xlsx');
const SalarySlip = require('../models/SalarySlip');
const Payroll = require('../models/Payroll');
const User = require('../models/User');
const SystemSetting = require('../models/SystemSetting');
const Bonus = require('../models/Bonus');
const Reimbursement = require('../models/Reimbursement');
const AttendanceRecord = require('../models/AttendanceRecord');
const { calculateSalary, commitSlipSideEffects, releaseSlipSideEffects, round2 } = require('../services/payroll.service');
const { generateSalarySlipPDF } = require('../services/pdf.service');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PRESENT_STATUSES = ['present', 'half_day', 'wfh'];

// Builds the trailing `count` months (oldest first, ending at month/year inclusive)
// used to drive the dashboard's trend/attendance/expense charts.
function trailingMonths(month, year, count) {
    const months = [];
    for (let i = count - 1; i >= 0; i -= 1) {
        const d = new Date(year, month - 1 - i, 1);
        months.push({ month: d.getMonth() + 1, year: d.getFullYear(), label: `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}` });
    }
    return months;
}

function fullName(user) {
    if (!user) return 'Unknown';
    return `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.employeeCode || 'Unknown';
}

const SLIP_FIELDS = [
    'employeeSnapshot', 'salaryStructureSnapshot', 'attendanceSummary', 'earnings', 'deductions',
    'bonuses', 'reimbursements', 'loans', 'advances', 'perDaySalary', 'grossSalary',
    'totalEarnings', 'totalDeductions', 'totalBonus', 'totalReimbursement', 'netSalary'
];

// Creates a brand new slip, or - if one already exists for this user/month/year
// and isn't locked/published/paid - transparently recomputes it in place.
// All DB writes happen inside the caller-supplied session so a bulk run
// never leaves half-applied bonus/loan bookkeeping behind on failure.
const generateSlipForUser = async (userId, month, year, actorId, session) => {
    const existing = await SalarySlip.findOne({ user: userId, month, year }).session(session);
    if (existing && (existing.isLocked || ['published', 'paid'].includes(existing.status))) {
        throw new Error('Salary slip is locked or already published and cannot be regenerated');
    }

    if (existing) {
        await releaseSlipSideEffects(existing, session);
    }

    const salaryData = await calculateSalary(userId, month, year);

    let slip;
    if (existing) {
        SLIP_FIELDS.forEach(field => { existing[field] = salaryData[field]; });
        existing.status = 'generated';
        existing.generatedBy = actorId;
        existing.generatedAt = new Date();
        existing.regeneratedCount = (existing.regeneratedCount || 0) + 1;
        await existing.save({ session });
        slip = existing;
    } else {
        const created = await SalarySlip.create([{
            user: userId,
            month,
            year,
            ...SLIP_FIELDS.reduce((acc, f) => ({ ...acc, [f]: salaryData[f] }), {}),
            status: 'generated',
            generatedBy: actorId
        }], { session });
        slip = created[0];
    }

    await commitSlipSideEffects(salaryData, slip._id, session);
    return slip;
};

const runGenerateForUser = async (userId, month, year, actorId) => {
    const session = await mongoose.startSession();
    try {
        let slip;
        await session.withTransaction(async () => {
            slip = await generateSlipForUser(userId, month, year, actorId, session);
        });
        const pdfUrl = await generateSalarySlipPDF(slip);
        slip.pdfUrl = pdfUrl;
        await slip.save();
        return slip;
    } finally {
        session.endSession();
    }
};

const buildPayrollTotals = (slips) => slips.reduce((acc, s) => ({
    totalGrossSalary: round2(acc.totalGrossSalary + s.grossSalary),
    totalDeductions: round2(acc.totalDeductions + s.totalDeductions),
    totalBonus: round2(acc.totalBonus + s.totalBonus),
    totalReimbursements: round2(acc.totalReimbursements + s.totalReimbursement),
    totalNetSalary: round2(acc.totalNetSalary + s.netSalary)
}), { totalGrossSalary: 0, totalDeductions: 0, totalBonus: 0, totalReimbursements: 0, totalNetSalary: 0 });

// @desc    Generate salary for a single employee
// @route   POST /api/payroll/generate/employee
// @access  Private/Admin
exports.generateSingleEmployeeSalary = async (req, res) => {
    try {
        const { userId, month, year } = req.body;
        if (!userId || !month || !year) return errorResponse(res, 'userId, month and year are required', 400);

        const user = await User.findById(userId);
        if (!user) return errorResponse(res, 'Employee not found', 404);

        const slip = await runGenerateForUser(userId, month, year, req.user.id);
        const totals = buildPayrollTotals([slip]);

        const payroll = await Payroll.create({
            month, year, scope: 'employee',
            slips: [slip._id],
            totalEmployees: 1, processedCount: 1, failedCount: 0,
            ...totals,
            status: 'completed',
            initiatedBy: req.user.id
        });

        logger.info(`Salary generated for ${user.employeeCode} - ${month}/${year} by ${req.user.email}`);
        return successResponse(res, { payroll, slip }, 'Salary generated successfully', 201);
    } catch (error) {
        logger.error('Generate single employee salary error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Shared implementation for department/company/bulk generation.
const generateForUserList = async (req, res, users, { scope, department }) => {
    const { month, year } = req.body;
    const results = { success: [], failed: [] };
    const slips = [];

    for (const user of users) {
        try {
            const slip = await runGenerateForUser(user._id, month, year, req.user.id);
            slips.push(slip);
            results.success.push(user.employeeCode);
        } catch (err) {
            results.failed.push({ user: user._id, employeeCode: user.employeeCode, reason: err.message });
        }
    }

    const totals = buildPayrollTotals(slips);
    const payroll = await Payroll.create({
        month, year, scope, department: department || null,
        slips: slips.map(s => s._id),
        totalEmployees: users.length,
        processedCount: results.success.length,
        failedCount: results.failed.length,
        failedEmployees: results.failed,
        ...totals,
        status: 'completed',
        initiatedBy: req.user.id
    });

    logger.info(`Bulk salary generation (${scope}) completed for ${month}/${year}. Success: ${results.success.length}, Failed: ${results.failed.length}`);
    return successResponse(res, { payroll, results }, 'Bulk salary generation completed', 201);
};

// @desc    Generate salary for an entire department
// @route   POST /api/payroll/generate/department
// @access  Private/Admin
exports.generateDepartmentSalary = async (req, res) => {
    try {
        const { department, month, year } = req.body;
        if (!department || !month || !year) return errorResponse(res, 'department, month and year are required', 400);

        const users = await User.find({ department, isActive: true, role: { $ne: 'admin' } });
        if (users.length === 0) return errorResponse(res, 'No active employees found in this department', 404);

        return await generateForUserList(req, res, users, { scope: 'department', department });
    } catch (error) {
        logger.error('Generate department salary error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Generate salary for the whole company / bulk generate
// @route   POST /api/payroll/generate/company
// @access  Private/Admin
exports.generateCompanySalary = async (req, res) => {
    try {
        const { month, year, userIds } = req.body;
        if (!month || !year) return errorResponse(res, 'month and year are required', 400);

        const query = { isActive: true, role: { $ne: 'admin' } };
        if (Array.isArray(userIds) && userIds.length > 0) query._id = { $in: userIds };

        const users = await User.find(query);
        if (users.length === 0) return errorResponse(res, 'No active employees found', 404);

        return await generateForUserList(req, res, users, { scope: 'company' });
    } catch (error) {
        logger.error('Generate company salary error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Generate payroll - single entry point that dispatches to the
//          employee/department/company generator based on which fields are
//          present in the body (userId -> employee, department -> department,
//          neither -> company-wide, optionally scoped by userIds).
// @route   POST /api/payroll/generate
// @access  Private/Admin
exports.generatePayroll = async (req, res) => {
    const { userId, department } = req.body;
    if (userId) return exports.generateSingleEmployeeSalary(req, res);
    if (department) return exports.generateDepartmentSalary(req, res);
    return exports.generateCompanySalary(req, res);
};

// @desc    Get all payroll runs
// @route   GET /api/payroll/runs
// @access  Private/Admin
exports.getPayrollRuns = async (req, res) => {
    try {
        const { page = 1, limit = 20, month, year, status, scope } = req.query;
        const query = {};
        if (month) query.month = parseInt(month);
        if (year) query.year = parseInt(year);
        if (status) query.status = status;
        if (scope) query.scope = scope;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Payroll.countDocuments(query);
        const runs = await Payroll.find(query)
            .populate('initiatedBy', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, runs, {
            page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get payroll runs error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get a single payroll run with its slips
// @route   GET /api/payroll/runs/:id
// @access  Private/Admin
exports.getPayrollRun = async (req, res) => {
    try {
        const run = await Payroll.findById(req.params.id)
            .populate('initiatedBy approvedBy rejectedBy publishedBy lockedBy', 'firstName lastName')
            .populate('slips');
        if (!run) return errorResponse(res, 'Payroll run not found', 404);
        return successResponse(res, run, 'Payroll run retrieved');
    } catch (error) {
        logger.error('Get payroll run error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// Applies a status transition to every slip in a payroll run.
const cascadeSlipStatus = async (run, updates) => {
    await SalarySlip.updateMany({ _id: { $in: run.slips } }, updates);
};

// @desc    Approve a payroll run (and every slip in it)
// @route   PUT /api/payroll/runs/:id/approve
// @access  Private/Admin
exports.approvePayrollRun = async (req, res) => {
    try {
        const run = await Payroll.findById(req.params.id);
        if (!run) return errorResponse(res, 'Payroll run not found', 404);

        run.status = 'approved';
        run.approvedBy = req.user.id;
        run.approvedAt = new Date();
        await run.save();
        await cascadeSlipStatus(run, { status: 'approved', approvedBy: req.user.id, approvedAt: new Date() });

        return successResponse(res, run, 'Payroll run approved');
    } catch (error) {
        logger.error('Approve payroll run error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Reject a payroll run (and every slip in it)
// @route   PUT /api/payroll/runs/:id/reject
// @access  Private/Admin
exports.rejectPayrollRun = async (req, res) => {
    try {
        const { reason } = req.body;
        const run = await Payroll.findById(req.params.id);
        if (!run) return errorResponse(res, 'Payroll run not found', 404);

        run.status = 'rejected';
        run.rejectedBy = req.user.id;
        run.rejectedAt = new Date();
        run.rejectionReason = reason;
        await run.save();
        await cascadeSlipStatus(run, { status: 'rejected', rejectedBy: req.user.id, rejectedAt: new Date(), rejectionReason: reason });

        return successResponse(res, run, 'Payroll run rejected');
    } catch (error) {
        logger.error('Reject payroll run error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Publish a payroll run - makes every slip visible to its employee and locks it
// @route   PUT /api/payroll/runs/:id/publish
// @access  Private/Admin
exports.publishPayrollRun = async (req, res) => {
    try {
        const run = await Payroll.findById(req.params.id);
        if (!run) return errorResponse(res, 'Payroll run not found', 404);
        if (run.status !== 'approved') return errorResponse(res, 'Payroll run must be approved before it can be published', 400);

        run.status = 'published';
        run.publishedBy = req.user.id;
        run.publishedAt = new Date();
        await run.save();
        await cascadeSlipStatus(run, {
            status: 'published', publishedBy: req.user.id, publishedAt: new Date(), isLocked: true
        });

        return successResponse(res, run, 'Payroll run published');
    } catch (error) {
        logger.error('Publish payroll run error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Lock a payroll run (and every slip in it) to prevent further edits
// @route   PUT /api/payroll/runs/:id/lock
// @access  Private/Admin
exports.lockPayrollRun = async (req, res) => {
    try {
        const run = await Payroll.findById(req.params.id);
        if (!run) return errorResponse(res, 'Payroll run not found', 404);

        run.status = 'locked';
        run.lockedBy = req.user.id;
        run.lockedAt = new Date();
        await run.save();
        await cascadeSlipStatus(run, { isLocked: true, lockedBy: req.user.id, lockedAt: new Date() });

        return successResponse(res, run, 'Payroll run locked');
    } catch (error) {
        logger.error('Lock payroll run error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Unlock a payroll run (and every slip in it)
// @route   PUT /api/payroll/runs/:id/unlock
// @access  Private/Admin
exports.unlockPayrollRun = async (req, res) => {
    try {
        const run = await Payroll.findById(req.params.id);
        if (!run) return errorResponse(res, 'Payroll run not found', 404);

        run.status = 'completed';
        run.lockedBy = null;
        run.lockedAt = null;
        await run.save();
        await SalarySlip.updateMany(
            { _id: { $in: run.slips }, status: { $nin: ['published', 'paid'] } },
            { isLocked: false, lockedBy: null, lockedAt: null }
        );

        return successResponse(res, run, 'Payroll run unlocked');
    } catch (error) {
        logger.error('Unlock payroll run error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Payroll summary dashboard
// @route   GET /api/payroll/dashboard
// @access  Private/Admin
exports.getPayrollDashboard = async (req, res) => {
    try {
        const now = new Date();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const year = parseInt(req.query.year) || now.getFullYear();

        const employeeFilter = { role: { $ne: 'admin' } };
        const [totalEmployees, activeEmployees] = await Promise.all([
            User.countDocuments(employeeFilter),
            User.countDocuments({ ...employeeFilter, isActive: true })
        ]);
        const inactiveEmployees = Math.max(totalEmployees - activeEmployees, 0);

        const [slipAgg] = await SalarySlip.aggregate([
            { $match: { month, year } },
            {
                $group: {
                    _id: null,
                    salaryGenerated: { $sum: 1 },
                    payrollAmount: { $sum: '$netSalary' },
                    totalBonus: { $sum: '$totalBonus' },
                    totalDeductions: { $sum: '$totalDeductions' },
                    pendingPayroll: { $sum: { $cond: [{ $in: ['$status', ['draft', 'generated', 'rejected']] }, 1, 0] } },
                    pendingSlipApprovals: { $sum: { $cond: [{ $eq: ['$status', 'generated'] }, 1, 0] } }
                }
            }
        ]);
        const slipSummary = slipAgg || {
            salaryGenerated: 0, payrollAmount: 0, totalBonus: 0, totalDeductions: 0,
            pendingPayroll: 0, pendingSlipApprovals: 0
        };

        const [pendingBonusApprovals, pendingReimbursementApprovals] = await Promise.all([
            Bonus.countDocuments({ status: 'pending' }),
            Reimbursement.countDocuments({ status: 'pending' })
        ]);
        const pendingApprovals = slipSummary.pendingSlipApprovals + pendingBonusApprovals + pendingReimbursementApprovals;

        // Today's attendance rate among active employees, used for the
        // "<Month> Status" KPI card.
        const startOfToday = moment().startOf('day').toDate();
        const endOfToday = moment().endOf('day').toDate();
        const presentToday = await AttendanceRecord.countDocuments({
            date: { $gte: startOfToday, $lte: endOfToday },
            status: { $in: PRESENT_STATUSES }
        });
        const todayStatusPct = activeEmployees > 0 ? Math.round((presentToday / activeEmployees) * 100) : 0;

        // Trailing 6-month series shared by the trend / attendance-vs-payroll /
        // salary-expense charts, so each chart can independently decide
        // whether it actually has anything worth plotting.
        const months = trailingMonths(month, year, 6);
        const monthlyData = await Promise.all(months.map(async (m) => {
            const start = moment.utc([m.year, m.month - 1, 1]).startOf('month').toDate();
            const end = moment.utc([m.year, m.month - 1, 1]).endOf('month').toDate();

            const [[slipTotals], [attendanceTotals]] = await Promise.all([
                SalarySlip.aggregate([
                    { $match: { month: m.month, year: m.year } },
                    { $group: { _id: null, gross: { $sum: '$grossSalary' }, net: { $sum: '$netSalary' }, earnings: { $sum: '$totalEarnings' }, deductions: { $sum: '$totalDeductions' } } }
                ]),
                AttendanceRecord.aggregate([
                    { $match: { date: { $gte: start, $lte: end } } },
                    { $group: { _id: null, total: { $sum: 1 }, present: { $sum: { $cond: [{ $in: ['$status', PRESENT_STATUSES] }, 1, 0] } } } }
                ])
            ]);

            const attTotal = attendanceTotals?.total || 0;
            return {
                label: m.label,
                gross: round2(slipTotals?.gross || 0),
                net: round2(slipTotals?.net || 0),
                earnings: round2(slipTotals?.earnings || 0),
                deductions: round2(slipTotals?.deductions || 0),
                attendancePct: attTotal > 0 ? Math.round(((attendanceTotals.present || 0) / attTotal) * 100) : 0
            };
        }));

        const trend = monthlyData.some((m) => m.gross || m.net)
            ? monthlyData.map((m) => ({ label: m.label, gross: m.gross, net: m.net }))
            : [];
        const salaryExpense = monthlyData.some((m) => m.earnings || m.deductions)
            ? monthlyData.map((m) => ({ label: m.label, earnings: m.earnings, deductions: m.deductions }))
            : [];
        const attendanceVsPayroll = monthlyData.some((m) => m.net || m.attendancePct)
            ? monthlyData.map((m) => ({ label: m.label, payroll: m.net, attendancePct: m.attendancePct }))
            : [];

        const departmentAgg = await SalarySlip.aggregate([
            { $match: { month, year, 'employeeSnapshot.department': { $nin: [null, ''] } } },
            { $group: { _id: '$employeeSnapshot.department', total: { $sum: '$netSalary' } } },
            { $sort: { total: -1 } }
        ]);
        const departmentDistribution = departmentAgg.map((d) => ({ department: d._id, total: round2(d.total) }));

        const bonusAgg = await Bonus.aggregate([
            { $match: { month, year, status: { $ne: 'rejected' } } },
            { $group: { _id: '$bonusType', amount: { $sum: '$amount' } } },
            { $sort: { amount: -1 } }
        ]);
        const bonusDistribution = bonusAgg.map((b) => ({ type: b._id, amount: round2(b.amount) }));

        const [recentSalaries, recentReimbursements, recentPendingBonuses, recentPendingReimbursements] = await Promise.all([
            SalarySlip.find().sort({ generatedAt: -1 }).limit(5),
            Reimbursement.find().sort({ createdAt: -1 }).limit(5).populate('user', 'firstName lastName employeeCode'),
            Bonus.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(5).populate('user', 'firstName lastName employeeCode'),
            Reimbursement.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(5).populate('user', 'firstName lastName employeeCode')
        ]);

        const recentActivities = {
            salaries: recentSalaries.map((s) => ({
                id: s._id,
                employeeName: s.employeeSnapshot?.fullName || 'Unknown',
                date: s.generatedAt,
                netSalary: s.netSalary
            })),
            reimbursements: recentReimbursements.map((r) => ({
                id: r._id,
                employeeName: fullName(r.user),
                category: r.category,
                date: r.expenseDate || r.createdAt,
                amount: r.amount
            })),
            approvals: [
                ...recentPendingBonuses.map((b) => ({ id: b._id, employeeName: fullName(b.user), type: 'Bonus approval' })),
                ...recentPendingReimbursements.map((r) => ({ id: r._id, employeeName: fullName(r.user), type: 'Reimbursement approval' }))
            ].slice(0, 5)
        };

        return successResponse(res, {
            month,
            year,
            summary: {
                totalEmployees,
                activeEmployees,
                inactiveEmployees,
                salaryGenerated: slipSummary.salaryGenerated,
                pendingPayroll: slipSummary.pendingPayroll,
                payrollAmount: round2(slipSummary.payrollAmount),
                pendingApprovals,
                totalBonus: round2(slipSummary.totalBonus),
                totalDeductions: round2(slipSummary.totalDeductions),
                todayStatusPct
            },
            trend,
            departmentDistribution,
            attendanceVsPayroll,
            salaryExpense,
            bonusDistribution,
            recentActivities
        }, 'Payroll dashboard retrieved');
    } catch (error) {
        logger.error('Get payroll dashboard error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// ---------------------------------------------------------------------------
// Payroll report - aggregate + per-employee breakdown of generated slips,
// and an Excel export of the same data.
// ---------------------------------------------------------------------------
const buildPayrollReportQuery = (query) => {
    const { month, year, department, status, userId } = query;
    const filter = {};
    if (month) filter.month = parseInt(month);
    if (year) filter.year = parseInt(year);
    if (status) filter.status = status;
    if (userId) filter.user = userId;
    if (department) filter['employeeSnapshot.department'] = department;
    return filter;
};

// @desc    Payroll report - summary totals + per-employee breakdown
// @route   GET /api/payroll/reports
// @access  Private/Admin
exports.getPayrollReport = async (req, res) => {
    try {
        const filter = buildPayrollReportQuery(req.query);
        const slips = await SalarySlip.find(filter)
            .populate('user', 'firstName lastName employeeCode department designation')
            .sort({ year: -1, month: -1, 'employeeSnapshot.employeeCode': 1 });

        const summary = slips.reduce((acc, s) => ({
            totalEmployees: acc.totalEmployees + 1,
            totalGrossSalary: round2(acc.totalGrossSalary + s.grossSalary),
            totalEarnings: round2(acc.totalEarnings + s.totalEarnings),
            totalDeductions: round2(acc.totalDeductions + s.totalDeductions),
            totalBonus: round2(acc.totalBonus + s.totalBonus),
            totalReimbursement: round2(acc.totalReimbursement + s.totalReimbursement),
            totalNetSalary: round2(acc.totalNetSalary + s.netSalary)
        }), {
            totalEmployees: 0, totalGrossSalary: 0, totalEarnings: 0, totalDeductions: 0,
            totalBonus: 0, totalReimbursement: 0, totalNetSalary: 0
        });

        return successResponse(res, { summary, records: slips }, 'Payroll report generated');
    } catch (error) {
        logger.error('Get payroll report error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Export the payroll report as an Excel file
// @route   GET /api/payroll/reports/export
// @access  Private/Admin
exports.exportPayrollReport = async (req, res) => {
    try {
        const filter = buildPayrollReportQuery(req.query);
        const slips = await SalarySlip.find(filter).sort({ year: -1, month: -1, 'employeeSnapshot.employeeCode': 1 });

        const rows = slips.map(s => ({
            'Employee Code': s.employeeSnapshot.employeeCode,
            'Employee Name': s.employeeSnapshot.fullName,
            'Department': s.employeeSnapshot.department,
            'Month': s.month,
            'Year': s.year,
            'Gross Salary': s.grossSalary,
            'Total Earnings': s.totalEarnings,
            'Total Deductions': s.totalDeductions,
            'Bonus': s.totalBonus,
            'Reimbursement': s.totalReimbursement,
            'Net Salary': s.netSalary,
            'Status': s.status
        }));

        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Payroll Report');
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        const { month, year } = req.query;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="payroll-report-${year || 'all'}-${month || 'all'}.xlsx"`);
        return res.send(buffer);
    } catch (error) {
        logger.error('Export payroll report error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// ---------------------------------------------------------------------------
// Payroll settings - admin-configurable global payroll defaults, stored as
// SystemSetting docs so they share plumbing with every other setting in the
// app. payroll_late_policy is the same key payroll.service.js's
// getLatePolicy() already reads at calculation time, so updating it here
// actually changes future payroll runs.
// ---------------------------------------------------------------------------
const PAYROLL_SETTINGS_SCHEMA = [
    { field: 'payrollCycleDay', settingKey: 'payroll_cycle_day', settingType: 'number', default: 1, description: 'Day of month when payroll cycle starts' },
    { field: 'defaultCurrency', settingKey: 'default_currency', settingType: 'string', default: 'INR', description: 'Default currency for salary' },
    { field: 'autoLockEnabled', settingKey: 'enable_auto_lock', settingType: 'boolean', default: true, description: 'Auto-lock payroll after generation/publish' },
    { field: 'lockAfterDays', settingKey: 'lock_after_days', settingType: 'number', default: 5, description: 'Days after month end to auto-lock payroll' },
    {
        field: 'latePolicy', settingKey: 'payroll_late_policy', settingType: 'json',
        default: [{ lateCount: 3, deductionDays: 0.5 }, { lateCount: 6, deductionDays: 1 }],
        description: 'Late-arrival deduction tiers used during payroll calculation'
    }
];

const parseSettingValue = (setting, settingType) => {
    if (!setting) return undefined;
    switch (settingType) {
        case 'number': return Number(setting.settingValue);
        case 'boolean': return setting.settingValue === true || setting.settingValue === 'true';
        case 'json': return typeof setting.settingValue === 'string' ? JSON.parse(setting.settingValue) : setting.settingValue;
        default: return setting.settingValue;
    }
};

// @desc    Get global payroll settings
// @route   GET /api/payroll/settings
// @access  Private/Admin
exports.getPayrollSettings = async (req, res) => {
    try {
        const keys = PAYROLL_SETTINGS_SCHEMA.map(s => s.settingKey);
        const settings = await SystemSetting.find({ settingKey: { $in: keys } });
        const byKey = {};
        settings.forEach(s => { byKey[s.settingKey] = s; });

        const result = {};
        PAYROLL_SETTINGS_SCHEMA.forEach(({ field, settingKey, settingType, default: def }) => {
            const setting = byKey[settingKey];
            result[field] = setting ? parseSettingValue(setting, settingType) : def;
        });

        return successResponse(res, result, 'Payroll settings retrieved');
    } catch (error) {
        logger.error('Get payroll settings error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update global payroll settings (partial - only sends the changed fields)
// @route   PUT /api/payroll/settings
// @access  Private/Admin
exports.updatePayrollSettings = async (req, res) => {
    try {
        const toUpdate = PAYROLL_SETTINGS_SCHEMA.filter(({ field }) => req.body[field] !== undefined);

        await Promise.all(toUpdate.map(({ field, settingKey, settingType, description }) => {
            const raw = req.body[field];
            const settingValue = settingType === 'boolean' ? Boolean(raw) : raw;
            return SystemSetting.findOneAndUpdate(
                { settingKey },
                { settingValue, settingType, description },
                { new: true, upsert: true }
            );
        }));

        logger.info(`Payroll settings updated by ${req.user.email}: ${toUpdate.map(u => u.field).join(', ') || '(none)'}`);
        return exports.getPayrollSettings(req, res);
    } catch (error) {
        logger.error('Update payroll settings error:', error);
        return errorResponse(res, error.message, 500);
    }
};

module.exports.runGenerateForUser = runGenerateForUser;
