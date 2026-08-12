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
    },
    // Admin decides paid vs unpaid at approval time - independent of the
    // leave type's own default, and overrides it. 'partial' splits totalDays
    // across paidDays/unpaidDays below.
    paidStatus: {
        type: String,
        enum: ['unpaid', 'paid', 'partial'],
        default: 'unpaid'
    },
    // Kept in sync with paidStatus on approval so paidDays + unpaidDays
    // always equals totalDays: fully paid -> (totalDays, 0), fully unpaid ->
    // (0, totalDays), partial -> whatever the admin split. Stored explicitly
    // (rather than derived) so the admin list/history can render the Paid |
    // Unpaid columns without re-deriving from paidStatus, and so payroll can
    // allocate specific calendar days for a partial approval.
    paidDays: {
        type: Number,
        default: 0,
        min: 0
    },
    unpaidDays: {
        type: Number,
        default: 0,
        min: 0
    },
    remarks: {
        type: String,
        trim: true
    },
    editedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    editedAt: Date
}, {
    timestamps: true
});

leaveRequestSchema.index({ user: 1 });
leaveRequestSchema.index({ status: 1 });
leaveRequestSchema.index({ startDate: 1 });
leaveRequestSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
