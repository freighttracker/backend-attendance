const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const {
    User, AttendanceRecord, AttendanceCorrectionRequest, EmployeeRule, AttendanceRule,
    LeaveRequest, LeaveBalance, LeaveType, SalaryStructure, SalarySlip, Payroll,
    Bonus, Reimbursement, Loan, AdvanceSalary, Holiday, WeekendConfig, SandwichLeavePolicy
} = require('../../models');

const seedDepartments = require('./seedDepartments');
const seedEmployees = require('./seedEmployees');
const seedSalaryStructures = require('./seedSalaryStructures');
const seedLeaves = require('./seedLeaves');
const seedAttendanceJune2026 = require('./seedAttendanceJune2026');
const seedExpenses = require('./seedExpenses');
const seedSalarySlips = require('./seedSalarySlips');
const seedPayrollJune2026 = require('./seedPayrollJune2026');
const seedDashboard = require('./seedDashboard');

const FALLBACK_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'info.freightrack@gmail.com';
const FALLBACK_ADMIN_PASSWORD = 'Admin@12345';

// Deletes every collection this seeder suite owns, but never touches admin
// User documents (or AuditLog/Notification/SalaryField, which can hold real
// history/config outside this suite's scope).
const clearSeededData = async () => {
    await Promise.all([
        User.deleteMany({ role: { $ne: 'admin' } }),
        AttendanceRecord.deleteMany({}),
        AttendanceCorrectionRequest.deleteMany({}),
        EmployeeRule.deleteMany({}),
        AttendanceRule.deleteMany({}),
        LeaveRequest.deleteMany({}),
        LeaveBalance.deleteMany({}),
        LeaveType.deleteMany({}),
        SalaryStructure.deleteMany({}),
        SalarySlip.deleteMany({}),
        Payroll.deleteMany({}),
        Bonus.deleteMany({}),
        Reimbursement.deleteMany({}),
        Loan.deleteMany({}),
        AdvanceSalary.deleteMany({}),
        Holiday.deleteMany({}),
        WeekendConfig.deleteMany({}),
        SandwichLeavePolicy.deleteMany({})
    ]);
    console.log('Cleared previously seeded data (admin accounts untouched)');
};

// Finds an existing admin to act as the actor for every seeded record. Only
// creates one if the database genuinely has none yet.
const resolveAdmin = async () => {
    const existing = await User.findOne({ role: 'admin' });
    if (existing) {
        console.log(`Using existing admin: ${existing.email}`);
        return existing;
    }

    const admin = await User.create({
        employeeCode: 'ADM001',
        email: FALLBACK_ADMIN_EMAIL,
        password: FALLBACK_ADMIN_PASSWORD,
        firstName: 'System',
        lastName: 'Admin',
        role: 'admin',
        isActive: true,
        isVerified: true,
        department: 'Management',
        designation: 'System Administrator',
        joiningDate: new Date('2019-01-01')
    });
    console.log(`No admin existed - created one: ${admin.email} / ${FALLBACK_ADMIN_PASSWORD} (change this password after logging in)`);
    return admin;
};

const run = async () => {
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    console.log('\n--- HRMS June 2026 seed starting ---\n');

    const admin = await resolveAdmin();
    await clearSeededData();

    await seedDepartments();
    const { employees } = await seedEmployees(admin);
    await seedSalaryStructures(employees, admin);
    await seedLeaves(employees, admin);
    await seedAttendanceJune2026(employees, admin);
    await seedExpenses(employees, admin);
    const { slips } = await seedSalarySlips(employees, admin);
    await seedPayrollJune2026(slips, admin);
    await seedDashboard();

    const activeCount = employees.filter(e => e.isActive).length;
    console.log('--- Seed complete ---');
    console.log(`Employees: ${employees.length} (${activeCount} active) | Admin login unchanged: ${admin.email}`);
    console.log('All seeded employees share the password: Employee@123');

    return { admin, employees, slips };
};

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Seed error:', error);
            process.exit(1);
        });
}

module.exports = run;
