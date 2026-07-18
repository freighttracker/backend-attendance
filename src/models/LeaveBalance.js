const mongoose = require('mongoose');

const leaveBalanceSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    leaveType: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LeaveType',
        required: true
    },
    year: {
        type: Number,
        required: true
    },
    totalDays: {
        type: Number,
        default: 0
    },
    usedDays: {
        type: Number,
        default: 0
    },
    pendingDays: {
        type: Number,
        default: 0
    },
    carryForwardDays: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

leaveBalanceSchema.index({ user: 1, leaveType: 1, year: 1 }, { unique: true });
leaveBalanceSchema.index({ user: 1 });
leaveBalanceSchema.index({ year: 1 });

module.exports = mongoose.model('LeaveBalance', leaveBalanceSchema);
