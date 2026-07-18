const mongoose = require('mongoose');
const { PAYROLL_STATUSES } = require('../utils/payrollConstants');

// A single payroll "run" - the record created every time an admin generates
// salary for one employee, a department, or the whole company. Individual
// SalarySlip documents are the source of truth for numbers; this document
// is the audit trail / control surface for approving, rejecting, publishing
// and locking a batch of slips together.
const payrollSchema = new mongoose.Schema({
    month: {
        type: Number,
        required: true,
        min: 1,
        max: 12
    },
    year: {
        type: Number,
        required: true
    },
    scope: {
        type: String,
        enum: ['employee', 'department', 'company'],
        required: true
    },
    department: {
        type: String,
        default: null
    },
    slips: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SalarySlip'
    }],
    totalEmployees: { type: Number, default: 0 },
    processedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    failedEmployees: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        employeeCode: String,
        reason: String
    }],
    totalGrossSalary: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    totalBonus: { type: Number, default: 0 },
    totalReimbursements: { type: Number, default: 0 },
    totalNetSalary: { type: Number, default: 0 },
    status: {
        type: String,
        enum: PAYROLL_STATUSES,
        default: 'draft'
    },
    initiatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectionReason: String,
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: Date,
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lockedAt: Date
}, {
    timestamps: true
});

payrollSchema.index({ month: 1, year: 1 });
payrollSchema.index({ status: 1 });
payrollSchema.index({ scope: 1 });

module.exports = mongoose.model('Payroll', payrollSchema);
