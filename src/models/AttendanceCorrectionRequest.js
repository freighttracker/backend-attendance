const mongoose = require('mongoose');

const correctionRequestSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    attendanceRecord: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AttendanceRecord'
    },
    date: {
        type: Date,
        required: true
    },
    requestedCheckIn: Date,
    requestedCheckOut: Date,
    // Admin-only: lets the approver directly force the day's outcome (e.g.
    // count a borderline checkout as a Full Day) instead of trusting the
    // hours-based ladder in computeCheckoutOutcome. Set at approval time,
    // never by the requesting employee.
    overrideStatus: {
        type: String,
        enum: ['present', 'absent', 'half_day', 'on_leave', 'weekend', 'holiday', 'wfh']
    },
    reason: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date,
    rejectionReason: String
}, {
    timestamps: true
});

correctionRequestSchema.index({ user: 1 });
correctionRequestSchema.index({ status: 1 });
correctionRequestSchema.index({ date: 1 });

module.exports = mongoose.model('AttendanceCorrectionRequest', correctionRequestSchema);
