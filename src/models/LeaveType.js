const mongoose = require('mongoose');

const leaveTypeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Leave type name is required'],
        trim: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    defaultDaysPerYear: {
        type: Number,
        default: 0,
        min: 0
    },
    isCarryForward: {
        type: Boolean,
        default: false
    },
    maxCarryForwardDays: {
        type: Number,
        default: 0,
        min: 0
    },
    isPaid: {
        type: Boolean,
        default: true
    },
    requiresApproval: {
        type: Boolean,
        default: true
    },
    minDaysBeforeApply: {
        type: Number,
        default: 0,
        min: 0
    },
    maxDaysAtOnce: {
        type: Number,
        default: 30,
        min: 1
    },
    colorCode: {
        type: String,
        default: '#3B82F6'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

leaveTypeSchema.index({ code: 1 });
leaveTypeSchema.index({ isActive: 1 });

module.exports = mongoose.model('LeaveType', leaveTypeSchema);
