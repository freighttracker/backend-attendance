const mongoose = require('mongoose');

const bonusSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    bonusType: {
        type: String,
        enum: ['monthly', 'performance', 'festival', 'yearly'],
        required: true
    },
    amount: {
        type: Number,
        required: [true, 'Bonus amount is required'],
        min: 0
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
    description: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'paid'],
        default: 'pending'
    },
    // Set once the bonus has actually been consumed by a salary slip, so it
    // can never be pulled into a second payroll run by mistake.
    isApplied: {
        type: Boolean,
        default: false
    },
    salarySlip: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SalarySlip',
        default: null
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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

bonusSchema.index({ user: 1, month: 1, year: 1 });
bonusSchema.index({ status: 1 });

module.exports = mongoose.model('Bonus', bonusSchema);
