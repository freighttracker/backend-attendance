const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // Stamped from the checking-in user's own record at check-in time (never
    // trust a client-supplied company/subCompany) so records can be scoped
    // without a join back through User for every query.
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        default: null
    },
    subCompany: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SubCompany',
        default: null
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
    // Overtime is only paid once an admin approves it. 'none' = no overtime
    // on this day; 'pending' = overtime logged, awaiting review. Payroll and
    // the salary estimate only ever use approvedOvertimeHours.
    overtimeStatus: {
        type: String,
        enum: ['none', 'pending', 'approved', 'rejected'],
        default: 'none'
    },
    approvedOvertimeHours: {
        type: Number,
        default: 0
    },
    overtimeReviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    overtimeReviewedAt: Date,
    overtimeRemarks: {
        type: String,
        trim: true
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
    // Audit trail for admin corrections (either a re-timed check-in/out that
    // was recalculated, or a direct manual status override) - kept separate
    // from approvedBy/approvedAt since those are also used for the plain
    // correction-request approval flow.
    isCorrected: {
        type: Boolean,
        default: false
    },
    // True only when an admin forced the day's status directly; such records
    // are left alone by the missed-checkout half-day sweep.
    isStatusOverridden: {
        type: Boolean,
        default: false
    },
    correctedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    correctedAt: Date,
    previousStatus: {
        type: String,
        enum: ['present', 'absent', 'half_day', 'on_leave', 'weekend', 'holiday', 'wfh']
    },
    correctionReason: {
        type: String,
        trim: true
    },
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

// Any change to the day's measured overtime (checkout, correction) voids a
// previous review - the new hours have to be approved again before they pay.
attendanceRecordSchema.pre('save', function (next) {
    if (this.isModified('overtimeHours') && !this.isModified('overtimeStatus')) {
        this.overtimeStatus = this.overtimeHours > 0 ? 'pending' : 'none';
        this.approvedOvertimeHours = 0;
        this.overtimeReviewedBy = undefined;
        this.overtimeReviewedAt = undefined;
    }
    next();
});

// Compound index to ensure one record per user per date
attendanceRecordSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceRecordSchema.index({ date: 1 });
attendanceRecordSchema.index({ status: 1 });
attendanceRecordSchema.index({ isLocked: 1 });
attendanceRecordSchema.index({ company: 1 });
attendanceRecordSchema.index({ subCompany: 1 });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
