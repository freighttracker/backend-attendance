const mongoose = require('mongoose');

const reimbursementSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    category: {
        type: String,
        enum: ['travel', 'fuel', 'internet', 'medical', 'food', 'other'],
        required: true
    },
    amount: {
        type: Number,
        required: [true, 'Reimbursement amount is required'],
        min: 0
    },
    description: {
        type: String,
        trim: true
    },
    expenseDate: {
        type: Date,
        required: true
    },
    billUrl: {
        type: String,
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
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'paid'],
        default: 'pending'
    },
    isApplied: {
        type: Boolean,
        default: false
    },
    salarySlip: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SalarySlip',
        default: null
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date,
    rejectionReason: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

reimbursementSchema.index({ user: 1, month: 1, year: 1 });
reimbursementSchema.index({ status: 1 });

module.exports = mongoose.model('Reimbursement', reimbursementSchema);
