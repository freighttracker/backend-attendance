const mongoose = require('mongoose');

const salarySlipSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
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
    earnings: {
        basicSalary: { type: Number, default: 0 },
        hra: { type: Number, default: 0 },
        da: { type: Number, default: 0 },
        conveyance: { type: Number, default: 0 },
        medical: { type: Number, default: 0 },
        specialAllowance: { type: Number, default: 0 },
        overtimeAmount: { type: Number, default: 0 },
        bonus: { type: Number, default: 0 },
        otherEarnings: { type: Number, default: 0 }
    },
    deductions: {
        pfDeduction: { type: Number, default: 0 },
        esiDeduction: { type: Number, default: 0 },
        professionalTax: { type: Number, default: 0 },
        tds: { type: Number, default: 0 },
        leaveDeduction: { type: Number, default: 0 },
        lateDeduction: { type: Number, default: 0 },
        otherDeductions: { type: Number, default: 0 }
    },
    grossSalary: {
        type: Number,
        required: true
    },
    totalDeductions: {
        type: Number,
        default: 0
    },
    netSalary: {
        type: Number,
        required: true
    },
    attendance: {
        workingDays: { type: Number, default: 0 },
        presentDays: { type: Number, default: 0 },
        absentDays: { type: Number, default: 0 },
        leaveDays: { type: Number, default: 0 },
        halfDays: { type: Number, default: 0 },
        overtimeHours: { type: Number, default: 0 },
        lateCount: { type: Number, default: 0 }
    },
    status: {
        type: String,
        enum: ['draft', 'generated', 'approved', 'paid'],
        default: 'draft'
    },
    generatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    generatedAt: {
        type: Date,
        default: Date.now
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date,
    paidAt: Date,
    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'cash', 'cheque', null],
        default: null
    },
    transactionId: String,
    pdfUrl: String,
    notes: String
}, {
    timestamps: true
});

salarySlipSchema.index({ user: 1, month: 1, year: 1 }, { unique: true });
salarySlipSchema.index({ user: 1 });
salarySlipSchema.index({ month: 1, year: 1 });
salarySlipSchema.index({ status: 1 });

module.exports = mongoose.model('SalarySlip', salarySlipSchema);
