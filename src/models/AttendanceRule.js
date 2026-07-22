const mongoose = require('mongoose');

const attendanceRuleSchema = new mongoose.Schema({
    ruleName: {
        type: String,
        required: [true, 'Rule name is required'],
        trim: true
    },
    checkInTime: {
        type: String,
        required: true,
        default: '09:00'
    },
    checkOutTime: {
        type: String,
        required: true,
        default: '18:00'
    },
    // Grace period AFTER office start - check-in up to this many minutes past
    // checkInTime still counts as on-time/present, not late. (Existing field,
    // kept as-is so already-configured rules keep working unchanged.)
    gracePeriodMinutes: {
        type: Number,
        default: 15,
        min: 0
    },
    // Grace period BEFORE office start - arriving up to this many minutes
    // early is still just "on time", not flagged as an early check-in.
    graceBeforeMinutes: {
        type: Number,
        default: 0,
        min: 0
    },
    // Hard floor: check-in is only accepted this many minutes before office
    // start at the earliest. Anyone earlier than this is handled per
    // earlyCheckinAction below. Must be >= graceBeforeMinutes to make sense.
    allowedEarlyCheckinMinutes: {
        type: Number,
        default: 60,
        min: 0
    },
    // What happens when a check-in arrives earlier than allowedEarlyCheckinMinutes:
    // 'mark' lets it through flagged as an early check-in; 'reject' blocks it outright.
    earlyCheckinAction: {
        type: String,
        enum: ['mark', 'reject'],
        default: 'mark'
    },
    halfDayHours: {
        type: Number,
        default: 4,
        min: 0
    },
    fullDayHours: {
        type: Number,
        default: 8,
        min: 0
    },
    // Working hours below this on checkout mark the day Absent outright,
    // regardless of half-day/full-day thresholds.
    absentThresholdHours: {
        type: Number,
        default: 2,
        min: 0
    },
    // Optional, purely informational - subtracted only when displaying the
    // office's expected working hours in Settings; never subtracted from an
    // employee's actual measured working hours.
    lunchBreakMinutes: {
        type: Number,
        default: 0,
        min: 0
    },
    overtimeThreshold: {
        type: Number,
        default: 8,
        min: 0
    },
    overtimeRateMultiplier: {
        type: Number,
        default: 1.5,
        min: 1
    },
    lateMarkAfterMinutes: {
        type: Number,
        default: 15,
        min: 0
    },
    earlyLeaveBeforeMinutes: {
        type: Number,
        default: 15,
        min: 0
    },
    maxLateCountPerMonth: {
        type: Number,
        default: 3,
        min: 0
    },
    maxEarlyLeaveCountPerMonth: {
        type: Number,
        default: 3,
        min: 0
    },
    isDefault: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

attendanceRuleSchema.index({ isDefault: 1 });
attendanceRuleSchema.index({ isActive: 1 });

module.exports = mongoose.model('AttendanceRule', attendanceRuleSchema);
