const mongoose = require('mongoose');

const systemSettingSchema = new mongoose.Schema({
    settingKey: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    settingValue: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    settingType: {
        type: String,
        enum: ['string', 'number', 'boolean', 'json'],
        default: 'string'
    },
    description: {
        type: String,
        trim: true
    },
    isEditable: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

systemSettingSchema.index({ settingKey: 1 });

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
