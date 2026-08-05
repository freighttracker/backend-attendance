const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const {
    User, AttendanceRecord, AttendanceCorrectionRequest, EmployeeRule, AttendanceRule,
    LeaveRequest, LeaveBalance, LeaveType, SalaryStructure, SalarySlip, Payroll,
    Bonus, Reimbursement, Loan, AdvanceSalary, Holiday, WeekendConfig, SandwichLeavePolicy,
    SystemSetting, AuditLog, Notification
} = require('../../models');

const ADMIN_EMAIL = 'info@freightrack.co';
const ADMIN_PASSWORD = 'admin123';

// Wipes every collection this project uses, admin included, so the database
// ends up holding nothing but the single admin account created below.
const clearAllData = async () => {
    await Promise.all([
        User.deleteMany({}),
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
        SandwichLeavePolicy.deleteMany({}),
        SystemSetting.deleteMany({}),
        AuditLog.deleteMany({}),
        Notification.deleteMany({})
    ]);
    console.log('Cleared all existing data');
};

const run = async () => {
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    console.log('\n--- Admin-only seed starting ---\n');

    await clearAllData();

    const admin = await User.create({
        employeeCode: 'ADM001',
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        firstName: 'System',
        lastName: 'Admin',
        role: 'admin',
        isActive: true,
        isVerified: true,
        department: 'Management',
        designation: 'System Administrator',
        joiningDate: new Date()
    });

    console.log('--- Seed complete ---');
    console.log(`Admin created -> Email: ${admin.email}  Password: ${ADMIN_PASSWORD}`);

    return { admin };
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
