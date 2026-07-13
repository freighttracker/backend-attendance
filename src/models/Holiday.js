const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Holiday name is required'],
        trim: true
    },
    date: {
        type: Date,
        required: true,
        unique: true
    },
    description: {
        type: String,
        trim: true
    },
    type: {
        type: String,
        enum: ['national', 'company', 'optional', 'restricted'],
        default: 'company'
    },
    isRecurring: {
        type: Boolean,
        default: false
    },
    recurringPattern: {
        type: String,
        enum: ['weekly', 'monthly', 'yearly', null],
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

holidaySchema.index({ date: 1 });
holidaySchema.index({ type: 1 });
holidaySchema.index({ isActive: 1 });

module.exports = mongoose.model('Holiday', holidaySchema);
