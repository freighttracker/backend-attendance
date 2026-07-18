const mongoose = require('mongoose');
const { CALCULATION_TYPES, BASE_COMPONENTS } = require('../utils/payrollConstants');

// A single configurable earning/deduction line - admin picks Fixed Amount
// or Percentage (of gross/basic) per component. No percentages are ever
// hardcoded in code; everything here is data driven.
const componentSchema = new mongoose.Schema({
    calculationType: { type: String, enum: CALCULATION_TYPES, default: 'fixed' },
    value: { type: Number, default: 0, min: 0 },
    baseComponent: { type: String, enum: BASE_COMPONENTS, default: 'monthlyGrossSalary' },
    isEnabled: { type: Boolean, default: true }
}, { _id: false });

const customComponentSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    calculationType: { type: String, enum: CALCULATION_TYPES, default: 'fixed' },
    value: { type: Number, default: 0, min: 0 },
    baseComponent: { type: String, enum: BASE_COMPONENTS, default: 'monthlyGrossSalary' },
    isEnabled: { type: Boolean, default: true }
}, { _id: false });

const earningsSchema = new mongoose.Schema({
    basicSalary: { type: componentSchema, default: () => ({ calculationType: 'percentage', value: 40 }) },
    hra: { type: componentSchema, default: () => ({ calculationType: 'percentage', value: 20 }) },
    specialAllowance: { type: componentSchema, default: () => ({}) },
    conveyanceAllowance: { type: componentSchema, default: () => ({}) },
    medicalAllowance: { type: componentSchema, default: () => ({}) },
    foodAllowance: { type: componentSchema, default: () => ({}) },
    internetAllowance: { type: componentSchema, default: () => ({}) },
    performanceIncentive: { type: componentSchema, default: () => ({}) },
    bonus: { type: componentSchema, default: () => ({}) },
    otherAllowances: { type: [customComponentSchema], default: [] }
}, { _id: false });

const deductionsSchema = new mongoose.Schema({
    pf: { type: componentSchema, default: () => ({}) },
    professionalTax: { type: componentSchema, default: () => ({}) },
    tds: { type: componentSchema, default: () => ({}) },
    esic: { type: componentSchema, default: () => ({}) },
    otherDeductions: { type: [customComponentSchema], default: [] }
}, { _id: false });

const overtimeSchema = new mongoose.Schema({
    isEnabled: { type: Boolean, default: false },
    // Fixed hourly rate, or a multiplier applied to the derived per-hour basic pay
    rateType: { type: String, enum: ['fixedHourlyRate', 'basicMultiplier'], default: 'basicMultiplier' },
    hourlyRate: { type: Number, default: 0, min: 0 },
    rateMultiplier: { type: Number, default: 1.5, min: 0 }
}, { _id: false });

// Immutable snapshot of a previous structure version, kept so past payroll
// runs can always be recalculated/audited against the rules that were
// actually in force at the time, even after the structure is revised.
const revisionSchema = new mongoose.Schema({
    monthlyGrossSalary: Number,
    annualCTC: Number,
    earnings: earningsSchema,
    deductions: deductionsSchema,
    overtime: overtimeSchema,
    effectiveFrom: Date,
    effectiveTo: Date,
    revisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    remarks: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now }
});

const salaryStructureSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    monthlyGrossSalary: {
        type: Number,
        required: [true, 'Monthly gross salary is required'],
        min: 0
    },
    annualCTC: {
        type: Number,
        required: [true, 'Annual CTC is required'],
        min: 0
    },
    effectiveFrom: {
        type: Date,
        required: true,
        default: Date.now
    },
    earnings: { type: earningsSchema, default: () => ({}) },
    deductions: { type: deductionsSchema, default: () => ({}) },
    overtime: { type: overtimeSchema, default: () => ({}) },
    revisionHistory: { type: [revisionSchema], default: [] },
    isActive: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

salaryStructureSchema.index({ user: 1 });
salaryStructureSchema.index({ isActive: 1 });

module.exports = mongoose.model('SalaryStructure', salaryStructureSchema);
