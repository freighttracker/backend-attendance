const mongoose = require('mongoose');

const weekendConfigSchema = new mongoose.Schema({
    dayOfWeek: {
        type: String,
        enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        required: true,
        unique: true
    },
    isWeekend: {
        type: Boolean,
        default: false
    },
    isHalfDay: {
        type: Boolean,
        default: false
    },
    halfDayHours: {
        type: Number,
        default: 4
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

weekendConfigSchema.index({ isWeekend: 1 });

module.exports = mongoose.model('WeekendConfig', weekendConfigSchema);
