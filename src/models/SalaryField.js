const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
    label: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    sortOrder: { type: Number, default: 0 }
}, { _id: false });

const salaryFieldSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Field name is required'],
        trim: true
    },
    code: {
        type: String,
        required: [true, 'Field code is required'],
        trim: true,
        lowercase: true,
        unique: true
    },
    description: {
        type: String,
        trim: true
    },
    // Which section of the salary form this field renders under.
    group: {
        type: String,
        enum: ['earning', 'deduction', 'other'],
        required: [true, 'Field group is required']
    },
    inputType: {
        type: String,
        enum: [
            'number', 'decimal', 'currency', 'percentage',
            'text', 'textarea',
            'select', 'multiselect', 'boolean', 'checkbox', 'radio', 'date'
        ],
        default: 'number'
    },
    defaultValue: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    // For inputType 'percentage': what the percentage is computed against.
    // null/'total' = Total Salary entered on the employee form; otherwise the `code`
    // of another salary field (that field must be computed first, i.e. have a lower sortOrder).
    calculationBase: {
        type: String,
        trim: true,
        lowercase: true,
        default: null
    },
    placeholder: {
        type: String,
        trim: true
    },
    options: {
        type: [optionSchema],
        default: []
    },
    isRequired: {
        type: Boolean,
        default: false
    },
    isEditable: {
        type: Boolean,
        default: true
    },
    isVisible: {
        type: Boolean,
        default: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    sortOrder: {
        type: Number,
        default: 0
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

salaryFieldSchema.index({ sortOrder: 1 });
salaryFieldSchema.index({ group: 1 });
salaryFieldSchema.index({ isActive: 1 });

module.exports = mongoose.model('SalaryField', salaryFieldSchema);
