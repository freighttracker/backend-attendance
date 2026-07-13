const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../config/database');
const {
    User,
    AttendanceRule,
    LeaveType,
    WeekendConfig,
    SandwichLeavePolicy,
    SystemSetting
} = require('../models');

const seedData = async () => {
    try {
        await connectDB();

        await User.deleteMany({});
        await AttendanceRule.deleteMany({});
        await LeaveType.deleteMany({});
        await WeekendConfig.deleteMany({});
        await SandwichLeavePolicy.deleteMany({});
        await SystemSetting.deleteMany({});

        console.log('Existing data cleared');

        const admin = await User.create({
            employeeCode: 'ADM001',
            email: 'admin@company.com',
            password: 'admin123',
            firstName: 'System',
            lastName: 'Admin',
            role: 'admin',
            isActive: true,
            isVerified: true,
            department: 'IT',
            designation: 'System Administrator',
            baseSalary: 50000
        });
        console.log('Admin user created:', admin.email);

        const defaultRule = await AttendanceRule.create({
            ruleName: 'Default Rule',
            checkInTime: '09:00',
            checkOutTime: '18:00',
            gracePeriodMinutes: 15,
            halfDayHours: 4,
            fullDayHours: 8,
            overtimeThreshold: 8,
            overtimeRateMultiplier: 1.5,
            lateMarkAfterMinutes: 15,
            earlyLeaveBeforeMinutes: 15,
            maxLateCountPerMonth: 3,
            maxEarlyLeaveCountPerMonth: 3,
            isDefault: true,
            isActive: true
        });
        console.log('Default attendance rule created');

        const leaveTypes = await LeaveType.insertMany([
            { name: 'Casual Leave', code: 'CL', description: 'Casual leave for personal matters', defaultDaysPerYear: 12, isCarryForward: false, isPaid: true, colorCode: '#3B82F6' },
            { name: 'Sick Leave', code: 'SL', description: 'Medical leave for health issues', defaultDaysPerYear: 10, isCarryForward: false, isPaid: true, colorCode: '#EF4444' },
            { name: 'Earned Leave', code: 'EL', description: 'Earned/Privilege leave', defaultDaysPerYear: 15, isCarryForward: true, maxCarryForwardDays: 30, isPaid: true, colorCode: '#10B981' },
            { name: 'Maternity Leave', code: 'ML', description: 'Maternity leave for female employees', defaultDaysPerYear: 180, isCarryForward: false, isPaid: true, colorCode: '#F59E0B' },
            { name: 'Paternity Leave', code: 'PL', description: 'Paternity leave for male employees', defaultDaysPerYear: 15, isCarryForward: false, isPaid: true, colorCode: '#8B5CF6' },
            { name: 'Compensatory Off', code: 'CO', description: 'Compensatory off for extra work', defaultDaysPerYear: 0, isCarryForward: false, isPaid: true, colorCode: '#EC4899' },
            { name: 'Loss of Pay', code: 'LOP', description: 'Leave without pay', defaultDaysPerYear: 0, isCarryForward: false, isPaid: false, colorCode: '#6B7280' },
            { name: 'Work From Home', code: 'WFH', description: 'Work from home request', defaultDaysPerYear: 0, isCarryForward: false, isPaid: true, colorCode: '#14B8A6' }
        ]);
        console.log(`${leaveTypes.length} leave types created`);

        const weekendConfigs = await WeekendConfig.insertMany([
            { dayOfWeek: 'sunday', isWeekend: true, isHalfDay: false, halfDayHours: 4 },
            { dayOfWeek: 'monday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
            { dayOfWeek: 'tuesday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
            { dayOfWeek: 'wednesday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
            { dayOfWeek: 'thursday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
            { dayOfWeek: 'friday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
            { dayOfWeek: 'saturday', isWeekend: true, isHalfDay: false, halfDayHours: 4 }
        ]);
        console.log('Weekend configurations created');

        await SandwichLeavePolicy.create({
            isEnabled: false,
            description: 'When an employee takes leave before and after a weekend/holiday, the weekend/holiday days are also counted as leave.',
            appliesToLeaveTypes: ['CL', 'EL'],
            minLeaveDays: 2
        });
        console.log('Sandwich leave policy created');

        await SystemSetting.insertMany([
            { settingKey: 'company_name', settingValue: 'Your Company', settingType: 'string', description: 'Company name displayed in the system' },
            { settingKey: 'company_address', settingValue: '', settingType: 'string', description: 'Company address' },
            { settingKey: 'company_logo', settingValue: '', settingType: 'string', description: 'Company logo URL' },
            { settingKey: 'enable_geofencing', settingValue: 'false', settingType: 'boolean', description: 'Enable geofencing for attendance' },
            { settingKey: 'geofence_radius', settingValue: '100', settingType: 'number', description: 'Geofence radius in meters' },
            { settingKey: 'enable_photo_capture', settingValue: 'true', settingType: 'boolean', description: 'Require photo capture during check-in/out' },
            { settingKey: 'enable_ip_restriction', settingValue: 'false', settingType: 'boolean', description: 'Restrict attendance by IP address' },
            { settingKey: 'default_currency', settingValue: 'INR', settingType: 'string', description: 'Default currency for salary' },
            { settingKey: 'payroll_cycle_day', settingValue: '1', settingType: 'number', description: 'Day of month when payroll cycle starts' },
            { settingKey: 'enable_auto_lock', settingValue: 'true', settingType: 'boolean', description: 'Auto-lock attendance after payroll generation' },
            { settingKey: 'lock_after_days', settingValue: '5', settingType: 'number', description: 'Days after month end to auto-lock attendance' }
        ]);
        console.log('System settings created');

        console.log('\nSeed completed successfully!');
        console.log('\nDefault credentials:');
        console.log('Email: admin@company.com');
        console.log('Password: admin123');

        process.exit(0);
    } catch (error) {
        console.error('Seed error:', error);
        process.exit(1);
    }
};

seedData();
