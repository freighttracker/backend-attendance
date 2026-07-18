const mongoose = require('mongoose');

const correctionRequestSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    attendanceRecord: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AttendanceRecord',
        required: true
    },
    requestedCheckIn: Date,
    requestedCheckOut: Date,
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

module.exports = mongoose.model('AttendanceCorrectionRequest', correctionRequestSchema);
