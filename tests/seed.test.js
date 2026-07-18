const moment = require('moment');
const { connect, closeDatabase } = require('./helpers/db');
const seedData = require('../src/scripts/seed');
const {
    User,
    Holiday,
    LeaveRequest,
    LeaveBalance,
    AttendanceRecord,
    AttendanceCorrectionRequest
} = require('../src/models');

beforeAll(async () => {
    await connect();
});

afterAll(async () => {
    await closeDatabase();
});

describe('seed script', () => {
    let result;

    beforeAll(async () => {
        result = await seedData();
    });

    test('creates one admin and the seeded employees', async () => {
        const users = await User.find({});
        expect(users.length).toBe(1 + 5); // admin + 5 employees
        const admin = users.find(u => u.role === 'admin');
        expect(admin.email).toBe('admin@company.com');
        expect(result.employees).toHaveLength(5);
    });

    test('creates holidays including national and company types', async () => {
        const holidays = await Holiday.find({});
        expect(holidays.length).toBe(3);
        expect(holidays.some(h => h.type === 'national')).toBe(true);
        expect(holidays.some(h => h.type === 'company')).toBe(true);
        expect(holidays.every(h => h.isActive)).toBe(true);
    });

    test('creates a full calendar month of attendance for every employee with no duplicate user/date pairs', async () => {
        const seedMonthStart = moment().subtract(1, 'month').startOf('month');
        const daysInMonth = seedMonthStart.clone().endOf('month').date();

        const records = await AttendanceRecord.find({});
        expect(records.length).toBe(daysInMonth * 5);

        const seenKeys = new Set();
        for (const r of records) {
            const key = `${r.user}_${moment(r.date).format('YYYY-MM-DD')}`;
            expect(seenKeys.has(key)).toBe(false);
            seenKeys.add(key);
        }

        const statuses = new Set(records.map(r => r.status));
        expect(statuses.has('present')).toBe(true);
        expect(statuses.has('weekend')).toBe(true);
        expect(statuses.has('holiday')).toBe(true);
        expect(statuses.has('absent')).toBe(true);
        expect(statuses.has('half_day')).toBe(true);
        expect(statuses.has('on_leave')).toBe(true);
    });

    test('creates leave requests in pending, approved and rejected states', async () => {
        const pending = await LeaveRequest.find({ status: 'pending' });
        const approved = await LeaveRequest.find({ status: 'approved' });
        const rejected = await LeaveRequest.find({ status: 'rejected' });

        expect(pending.length).toBe(2);
        expect(approved.length).toBe(1);
        expect(rejected.length).toBe(1);
    });

    test('approved leave updates the leave balance and marks attendance as on_leave', async () => {
        const approvedLeave = await LeaveRequest.findOne({ status: 'approved' }).populate('leaveType');
        const balance = await LeaveBalance.findOne({ user: approvedLeave.user, leaveType: approvedLeave.leaveType._id });
        expect(balance.usedDays).toBe(approvedLeave.totalDays);

        const onLeaveRecords = await AttendanceRecord.find({ user: approvedLeave.user, status: 'on_leave' });
        expect(onLeaveRecords.length).toBe(approvedLeave.totalDays);
    });

    test('pending leave requests reserve pending balance days', async () => {
        const pendingLeaves = await LeaveRequest.find({ status: 'pending' });
        for (const leave of pendingLeaves) {
            const balance = await LeaveBalance.findOne({ user: leave.user, leaveType: leave.leaveType });
            expect(balance.pendingDays).toBeGreaterThanOrEqual(leave.totalDays);
        }
    });

    test('creates pending attendance correction requests awaiting approval', async () => {
        const corrections = await AttendanceCorrectionRequest.find({ status: 'pending' });
        expect(corrections.length).toBe(2);
        for (const c of corrections) {
            expect(c.reason).toEqual(expect.any(String));
            expect(c.attendanceRecord).toBeTruthy();
        }
    });

    test('is idempotent when run twice (clears previous data)', async () => {
        await seedData();
        const users = await User.find({});
        expect(users.length).toBe(1 + 5);
        const holidays = await Holiday.find({});
        expect(holidays.length).toBe(3);
    });
});
