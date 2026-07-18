const mongoose = require('mongoose');

const employeeRuleSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    rule: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AttendanceRule',
        required: true
    },
    effectiveFrom: {
        type: Date,
        required: true
    },
    effectiveTo: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

employeeRuleSchema.index({ user: 1, effectiveFrom: 1 }, { unique: true });
employeeRuleSchema.index({ user: 1 });

module.exports = mongoose.model('EmployeeRule', employeeRuleSchema);
