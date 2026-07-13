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
    gracePeriodMinutes: {
        type: Number,
        default: 15,
        min: 0
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
