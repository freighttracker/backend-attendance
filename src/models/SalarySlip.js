const mongoose = require('mongoose');
const { SLIP_STATUSES } = require('../utils/payrollConstants');

// A generated salary line item - flexible so it can represent any
// admin-configured earning/deduction component without hardcoding a fixed
// list of columns. Snapshotted at generation time so history never changes
// even if the employee's salary structure is revised afterwards.
const lineItemSchema = new mongoose.Schema({
    key: { type: String, required: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
}, { _id: false });

const appliedRefSchema = new mongoose.Schema({
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String },
    amount: { type: Number, default: 0 }
}, { _id: false });

const salarySlipSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    payroll: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payroll',
        default: null
    },
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

    // Immutable copies taken at generation time so the slip never changes
    // retroactively if the employee record or salary structure is edited later.
    employeeSnapshot: {
        employeeCode: String,
        fullName: String,
        email: String,
        department: String,
        designation: String,
        panNumber: String,
        joiningDate: Date,
        bankDetails: {
            bankName: String,
            accountNumber: String,
            ifscCode: String,
            branch: String
        }
    },
    salaryStructureSnapshot: {
        monthlyGrossSalary: Number,
        annualCTC: Number,
        effectiveFrom: Date
    },

    attendanceSummary: {
        daysInMonth: { type: Number, default: 0 },
        workingDays: { type: Number, default: 0 },
        presentDays: { type: Number, default: 0 },
        absentDays: { type: Number, default: 0 },
        halfDays: { type: Number, default: 0 },
        paidLeaveDays: { type: Number, default: 0 },
        unpaidLeaveDays: { type: Number, default: 0 },
        weeklyOffs: { type: Number, default: 0 },
        holidays: { type: Number, default: 0 },
        lateCount: { type: Number, default: 0 },
        lateDeductionUnits: { type: Number, default: 0 }, // in equivalent days
        overtimeHours: { type: Number, default: 0 }
    },

    earnings: { type: [lineItemSchema], default: [] },
    deductions: { type: [lineItemSchema], default: [] },
    bonuses: { type: [appliedRefSchema], default: [] },
    reimbursements: { type: [appliedRefSchema], default: [] },
    loans: { type: [appliedRefSchema], default: [] },
    advances: { type: [appliedRefSchema], default: [] },

    perDaySalary: { type: Number, default: 0 },
    grossSalary: { type: Number, required: true, default: 0 },
    totalEarnings: { type: Number, required: true, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    totalBonus: { type: Number, default: 0 },
    totalReimbursement: { type: Number, default: 0 },
    netSalary: { type: Number, required: true, default: 0 },

    status: {
        type: String,
        enum: SLIP_STATUSES,
        default: 'draft'
    },
    isLocked: {
        type: Boolean,
        default: false
    },
    regeneratedCount: {
        type: Number,
        default: 0
    },

    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    generatedAt: { type: Date, default: Date.now },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectionReason: String,
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lockedAt: Date,
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: Date,
    paidAt: Date,
    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'cash', 'cheque', 'upi', null],
        default: null
    },
    transactionId: String,
    pdfUrl: String,
    emailSentAt: Date,
    notes: String
}, {
    timestamps: true
});

salarySlipSchema.index({ user: 1, month: 1, year: 1 }, { unique: true });
salarySlipSchema.index({ user: 1 });
salarySlipSchema.index({ month: 1, year: 1 });
salarySlipSchema.index({ status: 1 });
salarySlipSchema.index({ payroll: 1 });

module.exports = mongoose.model('SalarySlip', salarySlipSchema);
