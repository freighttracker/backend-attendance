const mongoose = require('mongoose');

const deductionEntrySchema = new mongoose.Schema({
    month: Number,
    year: Number,
    amount: Number,
    salarySlip: { type: mongoose.Schema.Types.ObjectId, ref: 'SalarySlip' },
    appliedAt: { type: Date, default: Date.now }
}, { _id: false });

const advanceSalarySchema = new mongoose.Schema({
   
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: [true, 'Advance amount is required'],
        min: 0
    },
    reason: {
        type: String,
        trim: true
    },
    deductionPerMonth: {
        type: Number,
        required: [true, 'Monthly deduction amount is required'],
        min: 0
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
        enum: ['pending', 'approved', 'rejected', 'active', 'closed'],
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

advanceSalarySchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('AdvanceSalary', advanceSalarySchema);
