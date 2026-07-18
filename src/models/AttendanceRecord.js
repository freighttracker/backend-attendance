const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    checkIn: {
        time: Date,
        location: String,
        ipAddress: String,
        device: String,
        photoUrl: String,
        latitude: Number,
        longitude: Number
    },
    checkOut: {
        time: Date,
        location: String,
        ipAddress: String,
        device: String,
        photoUrl: String,
        latitude: Number,
        longitude: Number
    },
    workingHours: {
        type: Number,
        default: 0
    },
    overtimeHours: {
        type: Number,
        default: 0
    },
    lateMinutes: {
        type: Number,
        default: 0
    },
    earlyLeaveMinutes: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['present', 'absent', 'half_day', 'on_leave', 'weekend', 'holiday', 'wfh'],
        default: 'absent'
    },
    isLate: {
        type: Boolean,
        default: false
    },
    isEarlyLeave: {
        type: Boolean,
        default: false
    },
    isOvertime: {
        type: Boolean,
        default: false
    },
    notes: {
        type: String,
        trim: true
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: Date,
    isLocked: {
        type: Boolean,
        default: false
    },
    lockedAt: Date,
    lockedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Compound index to ensure one record per user per date
attendanceRecordSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceRecordSchema.index({ date: 1 });
attendanceRecordSchema.index({ status: 1 });
attendanceRecordSchema.index({ isLocked: 1 });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
