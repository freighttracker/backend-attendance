const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { AttendanceRecord, LeaveRequest, LeaveType } = require('../src/models');

let app;
let admin;
let john;

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    admin = seeded.admin;
    [john] = seeded.employees;
});

afterAll(async () => {
    await closeDatabase();
});

describe('Payroll trusts LeaveRequest.paidStatus for the LOP calculation', () => {
    const seedMonthStart = moment().subtract(1, 'month').startOf('month');
    const month = seedMonthStart.month() + 1;
    const year = seedMonthStart.year();

    test('an approved unpaid leave day increments unpaidLeaveDays and produces a leave deduction line', async () => {
        // Pick a day the seeder marked 'present' in the first half of the
        // month (John's own approved-paid leave already occupies days 15-16).
        const presentRecord = await AttendanceRecord.findOne({
            user: john._id,
            status: 'present',
            date: { $gte: seedMonthStart.toDate(), $lt: seedMonthStart.clone().date(10).toDate() }
        });
        expect(presentRecord).not.toBeNull();

        const cl = await LeaveType.findOne({ code: 'CL' });
        await LeaveRequest.create({
            user: john._id,
            leaveType: cl._id,
            startDate: presentRecord.date,
            endDate: presentRecord.date,
            totalDays: 1,
            reason: 'Unpaid day off (test fixture)',
            status: 'approved',
            paidStatus: 'unpaid',
            approvedBy: admin._id,
            approvedAt: new Date()
        });
        presentRecord.status = 'on_leave';
        await presentRecord.save();

        const res = await request(app)
            .post('/api/payroll/generate')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ userId: john._id.toString(), month, year });

        expect(res.status).toBe(201);
        const summary = res.body.data.slip.attendanceSummary;
        expect(summary.unpaidLeaveDays).toBeGreaterThanOrEqual(1);

        const leaveDeduction = res.body.data.slip.deductions.find((d) => d.key === 'leaveDeduction');
        expect(leaveDeduction).toBeTruthy();
        expect(leaveDeduction.amount).toBeGreaterThan(0);
    });
});
