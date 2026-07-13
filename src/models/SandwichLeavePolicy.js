const mongoose = require('mongoose');

const sandwichLeavePolicySchema = new mongoose.Schema({
    isEnabled: {
        type: Boolean,
        default: false
    },
    description: {
        type: String,
        default: 'When an employee takes leave before and after a weekend/holiday, the weekend/holiday days are also counted as leave.'
    },
    appliesToLeaveTypes: [{
        type: String
    }],
    minLeaveDays: {
        type: Number,
        default: 2
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('SandwichLeavePolicy', sandwichLeavePolicySchema);
