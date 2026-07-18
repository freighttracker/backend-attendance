// Canonical list of configurable earning/deduction components used across
// SalaryStructure, SalarySlip and the payroll calculation engine.
// Keeping these in one place means the PDF, calculator and validators
// never drift out of sync with each other.

const EARNING_COMPONENTS = [
    { key: 'basicSalary', label: 'Basic Salary' },
    { key: 'hra', label: 'HRA' },
    { key: 'specialAllowance', label: 'Special Allowance' },
    { key: 'conveyanceAllowance', label: 'Conveyance Allowance' },
    { key: 'medicalAllowance', label: 'Medical Allowance' },
    { key: 'foodAllowance', label: 'Food Allowance' },
    { key: 'internetAllowance', label: 'Internet/Mobile Allowance' },
    { key: 'performanceIncentive', label: 'Performance Incentive' },
    { key: 'bonus', label: 'Bonus' }
];

const DEDUCTION_COMPONENTS = [
    { key: 'pf', label: 'Provident Fund (PF)' },
    { key: 'professionalTax', label: 'Professional Tax' },
    { key: 'tds', label: 'Income Tax (TDS)' },
    { key: 'esic', label: 'ESIC' }
];

// System-computed line items that are never configured as a fixed/percentage
// component on the salary structure - they are derived every run from
// attendance, leave, loans, advances etc.
const DERIVED_DEDUCTION_KEYS = ['leaveDeduction', 'lateDeduction', 'loanEmi', 'advanceDeduction', 'otherDeductions'];
const DERIVED_EARNING_KEYS = ['otherAllowances'];

const CALCULATION_TYPES = ['fixed', 'percentage'];
const BASE_COMPONENTS = ['monthlyGrossSalary', 'basicSalary'];

const PAYROLL_STATUSES = ['draft', 'processing', 'completed', 'approved', 'rejected', 'published', 'locked'];
const SLIP_STATUSES = ['draft', 'generated', 'approved', 'rejected', 'published', 'paid'];

module.exports = {
    EARNING_COMPONENTS,
    DEDUCTION_COMPONENTS,
    DERIVED_DEDUCTION_KEYS,
    DERIVED_EARNING_KEYS,
    CALCULATION_TYPES,
    BASE_COMPONENTS,
    PAYROLL_STATUSES,
    SLIP_STATUSES
};
