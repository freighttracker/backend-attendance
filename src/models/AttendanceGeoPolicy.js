const mongoose = require('mongoose');

// GPS/geofence rules for check-in and check-out. One document per company;
// company: null is the platform-wide default used by companies without
// their own. With no document at all both modes are 'off', which is exactly
// the pre-geofencing behaviour.
//
// Modes:
//   off     - location is not requested or validated.
//   flag    - location is required; out-of-geofence / low-accuracy actions
//             are recorded but flagged for admin review.
//   enforce - location is required and must pass; otherwise the action is
//             rejected (or recorded as a pending exception when the employee
//             gives a reason and allowExceptions is on).
const MODES = ['off', 'flag', 'enforce'];

const attendanceGeoPolicySchema = new mongoose.Schema({
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        default: null
    },
    checkInMode: {
        type: String,
        enum: MODES,
        default: 'off'
    },
    checkOutMode: {
        type: String,
        enum: MODES,
        default: 'off'
    },
    // Pre-filled as the radius of a newly created office.
    defaultRadiusMeters: {
        type: Number,
        default: 100,
        min: 10,
        max: 5000
    },
    // A reading whose reported accuracy is worse (larger) than this is not
    // trusted to prove the employee is inside a geofence.
    maxAccuracyMeters: {
        type: Number,
        default: 100,
        min: 5,
        max: 2000
    },
    allowExceptions: {
        type: Boolean,
        default: true
    },
    // Coordinates older than this are stripped from attendance records by
    // the purge script (the attendance itself is kept).
    locationRetentionDays: {
        type: Number,
        default: 365,
        min: 30,
        max: 3650
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

attendanceGeoPolicySchema.index({ company: 1 }, { unique: true });

attendanceGeoPolicySchema.statics.MODES = MODES;

module.exports = mongoose.model('AttendanceGeoPolicy', attendanceGeoPolicySchema);
