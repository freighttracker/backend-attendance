const { SalaryStructure } = require('../../models');
const { randInt, chance } = require('./utils');

// Builds one SalaryStructure per employee, driven by the monthlyGrossSalary
// seedEmployees.js already assigned (stored as user.baseSalary). Percentages
// mirror the component list payroll.service.js/payrollConstants.js already
// know how to resolve, so real payroll generation later works unchanged.
const seedSalaryStructures = async (employees, admin) => {
    const structures = [];

    for (const emp of employees) {
        const monthlyGrossSalary = emp.baseSalary;
        const annualCTC = monthlyGrossSalary * 12;
        const isSenior = ['CEO', 'HR Manager', 'Sales Manager', 'Operations Manager', 'Warehouse Manager'].includes(emp.designation);
        const isWarehouseLike = ['Warehouse', 'Logistics'].includes(emp.department);

        const otherAllowances = [];
        if (chance(0.2)) {
            otherAllowances.push({
                name: 'Shift Allowance',
                calculationType: 'fixed',
                value: randInt(1000, 2500),
                isEnabled: true
            });
        }

        const otherDeductions = [];
        if (isWarehouseLike && chance(0.3)) {
            otherDeductions.push({
                name: 'Uniform & Safety Gear Deduction',
                calculationType: 'fixed',
                value: randInt(200, 500),
                isEnabled: true
            });
        }

        const structure = await SalaryStructure.create({
            user: emp._id,
            monthlyGrossSalary,
            annualCTC,
            effectiveFrom: emp.joiningDate,
            earnings: {
                basicSalary: { calculationType: 'percentage', value: 45, baseComponent: 'monthlyGrossSalary', isEnabled: true },
                hra: { calculationType: 'percentage', value: 20, baseComponent: 'monthlyGrossSalary', isEnabled: true },
                specialAllowance: { calculationType: 'percentage', value: 15, baseComponent: 'monthlyGrossSalary', isEnabled: true },
                conveyanceAllowance: { calculationType: 'fixed', value: 1600, isEnabled: true },
                medicalAllowance: { calculationType: 'fixed', value: 1250, isEnabled: true },
                foodAllowance: { calculationType: 'fixed', value: randInt(1000, 2000), isEnabled: true },
                internetAllowance: { calculationType: 'fixed', value: randInt(500, 1000), isEnabled: true },
                performanceIncentive: { calculationType: 'fixed', value: isSenior ? randInt(4000, 10000) : (chance(0.4) ? randInt(1500, 5000) : 0), isEnabled: isSenior || chance(0.4) },
                bonus: { calculationType: 'fixed', value: 0, isEnabled: false },
                otherAllowances
            },
            deductions: {
                pf: { calculationType: 'percentage', value: 12, baseComponent: 'basicSalary', isEnabled: true },
                professionalTax: { calculationType: 'fixed', value: 200, isEnabled: true },
                tds: { calculationType: 'fixed', value: monthlyGrossSalary >= 100000 ? randInt(3000, 12000) : 0, isEnabled: monthlyGrossSalary >= 100000 },
                esic: { calculationType: 'percentage', value: 0.75, baseComponent: 'monthlyGrossSalary', isEnabled: monthlyGrossSalary <= 21000 },
                otherDeductions
            },
            overtime: { isEnabled: true, rateType: 'basicMultiplier', rateMultiplier: 1.5 },
            createdBy: admin._id,
            updatedBy: admin._id
        });

        structures.push(structure);
    }

    console.log(`Salary structures created for ${structures.length} employees`);
    return structures;
};

module.exports = seedSalaryStructures;
