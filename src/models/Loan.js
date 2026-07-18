const mongoose = require('mongoose');

// Tracks a single monthly deduction actually applied against a salary slip,
// keyed by month/year so payroll regeneration never double-deducts the EMI.
const deductionEntrySchema = new mongoose.Schema({
    month: Number,
    year: Number,
    amount: Number,
    salarySlip: { type: mongoose.Schema.Types.ObjectId, ref: 'SalarySlip' },
    appliedAt: { type: Date, default: Date.now }
}, { _id: false });

const loanSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    loanAmount: {
        type: Number,
        required: [true, 'Loan amount is required'],
        min: 0
    },
    reason: {
        type: String,
        trim: true
    },
    emiAmount: {
        type: Number,
        required: [true, 'EMI amount is required'],
        min: 0
    },
    tenureMonths: {
        type: Number,
        required: true,
        min: 1
    },
    startMonth: {
        type: Number,
        required: true,
        min: 1,
        max: 12
    },
    startYear: {
        type: Number,
        required: true
    },
    remainingBalance: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'active', 'closed', 'cancelled'],
        default: 'pending'
    },
    deductionsApplied: {
        type: [deductionEntrySchema],
        default: []
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date,
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

loanSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('Loan', loanSchema);
