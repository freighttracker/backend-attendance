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
    workingMinutes: {
        type: Number,
        default: 0
    },
    overtimeHours: {
        type: Number,
        default: 0
    },
    overtimeMinutes: {
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
    earlyCheckinMinutes: {
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
    isEarlyCheckin: {
        type: Boolean,
        default: false
    },
    isOvertime: {
        type: Boolean,
        default: false
    },
    isHalfDay: {
        type: Boolean,
        default: false
    },
    isAbsent: {
        type: Boolean,
        default: false
    },
    // True when check-in landed inside a grace window (before or after
    // office start) rather than exactly on time - i.e. grace was what kept
    // it from being flagged Late.
    isGraceUsed: {
        type: Boolean,
        default: false
    },
    // Snapshot of whatever AttendanceRule was actually in effect for this
    // record, so a later change to office timings never rewrites the history
    // of a day that already happened (same pattern as SalarySlip's
    // salaryStructureSnapshot).
    officeStartTime: String,
    officeEndTime: String,
    graceBeforeMinutes: Number,
    graceAfterMinutes: Number,
    allowedEarlyCheckinMinutes: Number,
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
