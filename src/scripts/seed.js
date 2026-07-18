const mongoose = require('mongoose');
const moment = require('moment');
require('dotenv').config();

const connectDB = require('../config/database');
const {
    User,
    AttendanceRule,
    LeaveType,
    LeaveBalance,
    LeaveRequest,
    Holiday,
    WeekendConfig,
    SandwichLeavePolicy,
    SystemSetting,
    AttendanceRecord,
    AttendanceCorrectionRequest,
    SalaryStructure,
    SalarySlip,
    Payroll,
    Bonus,
    Reimbursement,
    Loan,
    AdvanceSalary
} = require('../models');

const EMPLOYEE_PASSWORD = 'employee123';

const EMPLOYEE_SEED = [
    { employeeCode: 'EMP001', email: 'john.doe@company.com', firstName: 'John', lastName: 'Doe', department: 'Engineering', designation: 'Software Engineer', role: 'employee', baseSalary: 60000 },
    { employeeCode: 'EMP002', email: 'jane.smith@company.com', firstName: 'Jane', lastName: 'Smith', department: 'Engineering', designation: 'Senior Developer', role: 'employee', baseSalary: 80000 },
    { employeeCode: 'EMP003', email: 'robert.brown@company.com', firstName: 'Robert', lastName: 'Brown', department: 'Sales', designation: 'Sales Executive', role: 'employee', baseSalary: 45000 },
    { employeeCode: 'MGR001', email: 'emily.davis@company.com', firstName: 'Emily', lastName: 'Davis', department: 'Human Resources', designation: 'HR Manager', role: 'manager', baseSalary: 90000 },
    { employeeCode: 'EMP004', email: 'michael.wilson@company.com', firstName: 'Michael', lastName: 'Wilson', department: 'Marketing', designation: 'Marketing Executive', role: 'employee', baseSalary: 42000 }
];

// Leave types for which we track a balance in the seed (paid, common to all employees)
const BALANCE_LEAVE_CODES = ['CL', 'SL', 'EL'];

// Nudges a moment date forward off a weekend and returns it (mutates a clone, safe to reassign)
const toWeekday = (m) => {
    const clone = m.clone();
    const day = clone.day(); // 0 = Sunday, 6 = Saturday
    if (day === 0) clone.add(1, 'day');
    else if (day === 6) clone.add(2, 'day');
    return clone;
};

const seedData = async () => {
    // Avoid clobbering an already-open connection (e.g. an in-memory test DB)
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    await User.deleteMany({});
    await AttendanceRule.deleteMany({});
    await LeaveType.deleteMany({});
    await LeaveBalance.deleteMany({});
    await LeaveRequest.deleteMany({});
    await Holiday.deleteMany({});
    await WeekendConfig.deleteMany({});
    await SandwichLeavePolicy.deleteMany({});
    await SystemSetting.deleteMany({});
    await AttendanceRecord.deleteMany({});
    await AttendanceCorrectionRequest.deleteMany({});
    await SalaryStructure.deleteMany({});
    await SalarySlip.deleteMany({});
    await Payroll.deleteMany({});
    await Bonus.deleteMany({});
    await Reimbursement.deleteMany({});
    await Loan.deleteMany({});
    await AdvanceSalary.deleteMany({});

    console.log('Existing data cleared');

    // ---- Admin ----
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
        baseSalary: 50000,
        joiningDate: moment().subtract(3, 'years').toDate()
    });
    console.log('Admin user created:', admin.email);

    // ---- Attendance rule ----
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

    // ---- Leave types ----
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
    const leaveTypeByCode = {};
    leaveTypes.forEach(lt => { leaveTypeByCode[lt.code] = lt; });

    // ---- Weekend configuration ----
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
    const weekendDayNames = new Set(weekendConfigs.filter(w => w.isWeekend).map(w => w.dayOfWeek));

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
        { settingKey: 'lock_after_days', settingValue: '5', settingType: 'number', description: 'Days after month end to auto-lock attendance' },
        { settingKey: 'company_pan', settingValue: 'AAAAA0000A', settingType: 'string', description: 'Company PAN shown on salary slips' },
        { settingKey: 'company_bank_name', settingValue: 'HDFC Bank', settingType: 'string', description: 'Company bank name shown on salary slips' },
        {
            settingKey: 'payroll_late_policy',
            settingValue: [
                { lateCount: 3, deductionDays: 0.5 },
                { lateCount: 6, deductionDays: 1 }
            ],
            settingType: 'json',
            description: 'Late-mark thresholds and the equivalent day(s) of salary deducted once reached'
        }
    ]);
    console.log('System settings created');

    // ---- Employees ----
    const employees = [];
    for (const emp of EMPLOYEE_SEED) {
        const user = await User.create({
            ...emp,
            password: EMPLOYEE_PASSWORD,
            isActive: true,
            isVerified: true,
            joiningDate: moment().subtract(2, 'years').toDate()
        });
        employees.push(user);
    }
    console.log(`${employees.length} employees created`);

    // ---- Salary structures (admin-configured, fixed vs percentage per component) ----
    const structureEffectiveFrom = moment().subtract(2, 'years').toDate();
    const salaryStructures = [];
    for (const emp of employees) {
        const structure = await SalaryStructure.create({
            user: emp._id,
            monthlyGrossSalary: emp.baseSalary,
            annualCTC: emp.baseSalary * 12,
            effectiveFrom: structureEffectiveFrom,
            earnings: {
                basicSalary: { calculationType: 'percentage', value: 50, baseComponent: 'monthlyGrossSalary', isEnabled: true },
                hra: { calculationType: 'percentage', value: 20, baseComponent: 'monthlyGrossSalary', isEnabled: true },
                specialAllowance: { calculationType: 'percentage', value: 15, baseComponent: 'monthlyGrossSalary', isEnabled: true },
                conveyanceAllowance: { calculationType: 'fixed', value: 1600, isEnabled: true },
                medicalAllowance: { calculationType: 'fixed', value: 1250, isEnabled: true },
                foodAllowance: { calculationType: 'fixed', value: 1000, isEnabled: true },
                internetAllowance: { calculationType: 'fixed', value: 500, isEnabled: true },
                performanceIncentive: { calculationType: 'fixed', value: 0, isEnabled: false },
                bonus: { calculationType: 'fixed', value: 0, isEnabled: false }
            },
            deductions: {
                pf: { calculationType: 'percentage', value: 12, baseComponent: 'basicSalary', isEnabled: true },
                professionalTax: { calculationType: 'fixed', value: 200, isEnabled: true },
                tds: { calculationType: 'fixed', value: 0, isEnabled: false },
                esic: { calculationType: 'percentage', value: 0.75, baseComponent: 'monthlyGrossSalary', isEnabled: emp.baseSalary <= 21000 }
            },
            overtime: { isEnabled: true, rateType: 'basicMultiplier', rateMultiplier: 1.5 },
            createdBy: admin._id,
            updatedBy: admin._id
        });
        salaryStructures.push(structure);
    }
    console.log(`Salary structures created for ${salaryStructures.length} employees`);

    // ---- Leave balances (current year, for CL/SL/EL) ----
    const currentYear = moment().year();
    for (const emp of employees) {
        for (const code of BALANCE_LEAVE_CODES) {
            await LeaveBalance.create({
                user: emp._id,
                leaveType: leaveTypeByCode[code]._id,
                year: currentYear,
                totalDays: leaveTypeByCode[code].defaultDaysPerYear,
                usedDays: 0,
                pendingDays: 0,
                carryForwardDays: 0
            });
        }
    }
    console.log(`Leave balances created for ${employees.length} employees`);

    // ---- Holidays ----
    const seedMonthStart = moment().subtract(1, 'month').startOf('month');
    const holidayDocs = await Holiday.insertMany([
        {
            name: 'Founders Day',
            date: toWeekday(seedMonthStart.clone().date(10)).startOf('day').toDate(),
            description: 'Company founding anniversary',
            type: 'company',
            isActive: true,
            createdBy: admin._id
        },
        {
            name: 'National Holiday',
            date: toWeekday(seedMonthStart.clone().date(20)).startOf('day').toDate(),
            description: 'National public holiday',
            type: 'national',
            isActive: true,
            createdBy: admin._id
        },
        {
            name: 'Festival Holiday',
            date: toWeekday(moment().add(1, 'month').startOf('month').date(5)).startOf('day').toDate(),
            description: 'Upcoming festival holiday',
            type: 'optional',
            isActive: true,
            createdBy: admin._id
        }
    ]);
    console.log(`${holidayDocs.length} holidays created`);
    const holidayDateKeys = new Set(
        holidayDocs.map(h => moment(h.date).format('YYYY-MM-DD'))
    );

    // ---- One full month of attendance records per employee ----
    const daysInMonth = seedMonthStart.clone().endOf('month').date();
    const attendanceByUser = {};

    for (let i = 0; i < employees.length; i++) {
        const emp = employees[i];
        const records = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const date = seedMonthStart.clone().date(d).startOf('day');
            const dayName = date.format('dddd').toLowerCase();
            const dateKey = date.format('YYYY-MM-DD');

            if (weekendDayNames.has(dayName)) {
                records.push({ user: emp._id, date: date.toDate(), status: 'weekend' });
                continue;
            }

            if (holidayDateKeys.has(dateKey)) {
                records.push({ user: emp._id, date: date.toDate(), status: 'holiday' });
                continue;
            }

            const seedVal = (i * 31 + d) % 20;
            const record = { user: emp._id, date: date.toDate() };

            if (seedVal === 0) {
                // Absent
                record.status = 'absent';
            } else if (seedVal <= 2) {
                // Half day
                const checkInTime = date.clone().hour(9).minute(10);
                const checkOutTime = date.clone().hour(13).minute(0);
                record.checkIn = { time: checkInTime.toDate(), location: 'Office', device: 'Web' };
                record.checkOut = { time: checkOutTime.toDate(), location: 'Office', device: 'Web' };
                record.workingHours = parseFloat(checkOutTime.diff(checkInTime, 'hours', true).toFixed(2));
                record.status = 'half_day';
                record.isEarlyLeave = true;
                record.earlyLeaveMinutes = 300;
            } else if (seedVal <= 5) {
                // Present but late
                const lateMinutes = 20 + (d % 15);
                const checkInTime = date.clone().hour(9).minute(0).add(lateMinutes, 'minutes');
                const checkOutTime = date.clone().hour(18).minute(0);
                record.checkIn = { time: checkInTime.toDate(), location: 'Office', device: 'Web' };
                record.checkOut = { time: checkOutTime.toDate(), location: 'Office', device: 'Web' };
                record.workingHours = parseFloat(checkOutTime.diff(checkInTime, 'hours', true).toFixed(2));
                record.status = 'present';
                record.isLate = true;
                record.lateMinutes = lateMinutes;
            } else {
                // On time present, occasional overtime
                const isOvertimeDay = d % 9 === 0;
                const checkInTime = date.clone().hour(9).minute(d % 10);
                const checkOutTime = isOvertimeDay
                    ? date.clone().hour(19).minute(45)
                    : date.clone().hour(18).minute(d % 20);
                const workingHours = parseFloat(checkOutTime.diff(checkInTime, 'hours', true).toFixed(2));
                record.checkIn = { time: checkInTime.toDate(), location: 'Office', device: 'Web' };
                record.checkOut = { time: checkOutTime.toDate(), location: 'Office', device: 'Web' };
                record.workingHours = workingHours;
                record.status = 'present';
                record.isOvertime = isOvertimeDay;
                record.overtimeHours = isOvertimeDay ? parseFloat((workingHours - 8).toFixed(2)) : 0;
            }

            records.push(record);
        }

        attendanceByUser[emp._id.toString()] = await AttendanceRecord.insertMany(records);
    }
    console.log(`One month of attendance records created for ${employees.length} employees (${seedMonthStart.format('MMMM YYYY')})`);

    // ---- Leave requests: approved (retroactively marks attendance on_leave), pending, rejected ----
    const [john, jane, robert, emily] = employees;

    // ---- Sample payroll extras for the seeded month, to demo bonus/reimbursement/loan deductions ----
    const seedMonth = seedMonthStart.month() + 1;
    const seedYear = seedMonthStart.year();

    await Bonus.create({
        user: john._id,
        bonusType: 'performance',
        amount: 5000,
        month: seedMonth,
        year: seedYear,
        description: 'Outstanding project delivery',
        status: 'approved',
        createdBy: admin._id,
        approvedBy: admin._id,
        approvedAt: new Date()
    });

    await Reimbursement.create({
        user: jane._id,
        category: 'travel',
        amount: 2200,
        description: 'Client site visit travel expense',
        expenseDate: seedMonthStart.clone().date(8).toDate(),
        month: seedMonth,
        year: seedYear,
        status: 'approved',
        approvedBy: admin._id,
        approvedAt: new Date()
    });

    await Loan.create({
        user: robert._id,
        loanAmount: 30000,
        reason: 'Personal emergency loan',
        emiAmount: 5000,
        tenureMonths: 6,
        startMonth: seedMonth,
        startYear: seedYear,
        remainingBalance: 30000,
        status: 'active',
        createdBy: admin._id,
        approvedBy: admin._id,
        approvedAt: new Date()
    });
    console.log('Sample bonus, reimbursement and loan created for the seeded month');

    // Approved: John Doe, Earned Leave, 2 weekdays within the seeded month
    const approvedStart = toWeekday(seedMonthStart.clone().date(15));
    const approvedEnd = toWeekday(seedMonthStart.clone().date(16));
    const approvedLeave = await LeaveRequest.create({
        user: john._id,
        leaveType: leaveTypeByCode.EL._id,
        startDate: approvedStart.toDate(),
        endDate: approvedEnd.toDate(),
        totalDays: 2,
        reason: 'Family function',
        status: 'approved',
        approvedBy: admin._id,
        approvedAt: new Date()
    });
    await LeaveBalance.findOneAndUpdate(
        { user: john._id, leaveType: leaveTypeByCode.EL._id, year: currentYear },
        { $inc: { usedDays: approvedLeave.totalDays } }
    );
    for (const day of [approvedStart, approvedEnd]) {
        await AttendanceRecord.findOneAndUpdate(
            { user: john._id, date: day.clone().startOf('day').toDate() },
            {
                user: john._id,
                date: day.clone().startOf('day').toDate(),
                status: 'on_leave',
                notes: `Leave: ${leaveTypeByCode.EL.name}`
            },
            { upsert: true, new: true }
        );
    }
    console.log('Approved leave request created (John Doe, Earned Leave)');

    // Pending: Jane Smith, Casual Leave, 2 upcoming weekdays -- awaiting admin approval
    const janeStart = toWeekday(moment().add(1, 'month').startOf('month').date(5));
    const janeEnd = toWeekday(moment().add(1, 'month').startOf('month').date(6));
    const pendingLeave1 = await LeaveRequest.create({
        user: jane._id,
        leaveType: leaveTypeByCode.CL._id,
        startDate: janeStart.toDate(),
        endDate: janeEnd.toDate(),
        totalDays: 2,
        reason: 'Personal work',
        status: 'pending'
    });
    await LeaveBalance.findOneAndUpdate(
        { user: jane._id, leaveType: leaveTypeByCode.CL._id, year: currentYear },
        { $inc: { pendingDays: pendingLeave1.totalDays } }
    );

    // Pending: Robert Brown, Sick Leave, 1 upcoming weekday -- awaiting admin approval
    const robertDay = toWeekday(moment().add(1, 'month').startOf('month').date(10));
    const pendingLeave2 = await LeaveRequest.create({
        user: robert._id,
        leaveType: leaveTypeByCode.SL._id,
        startDate: robertDay.toDate(),
        endDate: robertDay.toDate(),
        totalDays: 1,
        reason: 'Medical checkup',
        status: 'pending'
    });
    await LeaveBalance.findOneAndUpdate(
        { user: robert._id, leaveType: leaveTypeByCode.SL._id, year: currentYear },
        { $inc: { pendingDays: pendingLeave2.totalDays } }
    );
    console.log('Pending leave requests created (Jane Smith, Robert Brown)');

    // Rejected: Emily Davis, Casual Leave, 1 upcoming weekday
    const emilyDay = toWeekday(moment().add(1, 'month').startOf('month').date(12));
    await LeaveRequest.create({
        user: emily._id,
        leaveType: leaveTypeByCode.CL._id,
        startDate: emilyDay.toDate(),
        endDate: emilyDay.toDate(),
        totalDays: 1,
        reason: 'Personal trip',
        status: 'rejected',
        approvedBy: admin._id,
        approvedAt: new Date(),
        rejectionReason: 'Insufficient staffing during that period'
    });
    console.log('Rejected leave request created (Emily Davis)');

    // ---- Attendance correction requests (pending admin approval) ----
    const janeRecords = attendanceByUser[jane._id.toString()];
    const janeLateRecord = janeRecords.find(r => r.isLate);
    if (janeLateRecord) {
        await AttendanceCorrectionRequest.create({
            user: jane._id,
            attendanceRecord: janeLateRecord._id,
            requestedCheckIn: moment(janeLateRecord.date).hour(9).minute(5).toDate(),
            reason: 'Biometric device malfunction, actual check-in time was earlier',
            status: 'pending'
        });
    }

    const wilson = employees[4];
    const wilsonRecords = attendanceByUser[wilson._id.toString()];
    const wilsonHalfDayRecord = wilsonRecords.find(r => r.status === 'half_day');
    if (wilsonHalfDayRecord) {
        await AttendanceCorrectionRequest.create({
            user: wilson._id,
            attendanceRecord: wilsonHalfDayRecord._id,
            requestedCheckOut: moment(wilsonHalfDayRecord.date).hour(18).minute(0).toDate(),
            reason: 'Stayed back for client call, checkout was not recorded',
            status: 'pending'
        });
    }
    console.log('Pending attendance correction requests created (Jane Smith, Michael Wilson)');

    console.log('\nSeed completed successfully!');
    console.log('\nDefault credentials:');
    console.log('Admin    -> Email: admin@company.com          Password: admin123');
    console.log(`Employees -> Email: <see list below>           Password: ${EMPLOYEE_PASSWORD}`);
    employees.forEach(e => console.log(`  - ${e.email} (${e.employeeCode}, ${e.role})`));

    return { admin, employees, leaveTypes, holidays: holidayDocs };
};

if (require.main === module) {
    seedData()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Seed error:', error);
            process.exit(1);
        });
}

module.exports = seedData;
