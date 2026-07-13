const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({
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
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    totalDays: {
        type: Number,
        required: true
    },
    reason: {
        type: String,
        required: [true, 'Reason is required'],
        trim: true
    },
    attachmentUrl: {
        type: String,
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'cancelled'],
        default: 'pending'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date,
    rejectionReason: {
        type: String,
        trim: true
    },
    isSandwichLeave: {
        type: Boolean,
        default: false
    },
    sandwichLeaveDays: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

leaveRequestSchema.index({ user: 1 });
leaveRequestSchema.index({ status: 1 });
leaveRequestSchema.index({ startDate: 1 });
leaveRequestSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
