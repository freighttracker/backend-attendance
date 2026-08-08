const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { LeaveType, LeaveBalance } = require('../src/models');

let app;
let wilson;

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    wilson = seeded.employees[4];
});

afterAll(async () => {
    await closeDatabase();
});

function nextWeekday(monthsAhead) {
    const date = moment().add(monthsAhead, 'months').startOf('month');
    while (date.day() === 0 || date.day() === 6) date.add(1, 'day');
    return date;
}

describe('Leave balance rules', () => {
    test('applying for more days than the leave type allows in one go is rejected', async () => {
        const clType = await LeaveType.findOne({ code: 'CL' }); // defaultDaysPerYear: 12, maxDaysAtOnce default 30
        const start = nextWeekday(6);
        // 20 consecutive calendar days comfortably exceeds the 12-day CL balance
        const end = start.clone().add(19, 'days');

        const res = await request(app)
            .post('/api/leaves/apply')
            .set('Authorization', `Bearer ${tokenFor(wilson)}`)
            .field('leaveTypeId', clType._id.toString())
            .field('startDate', start.format('YYYY-MM-DD'))
            .field('endDate', end.format('YYYY-MM-DD'))
            .field('reason', 'insufficient balance test');

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Insufficient leave balance/);
    });

    test('a leave balance is auto-provisioned the first time an employee applies for a given leave type/year', async () => {
        const slType = await LeaveType.findOne({ code: 'SL' });
        const year = moment().add(7, 'months').year();
        const before = await LeaveBalance.findOne({ user: wilson._id, leaveType: slType._id, year });
        expect(before).toBeNull();

        const date = nextWeekday(7);
        const res = await request(app)
            .post('/api/leaves/apply')
            .set('Authorization', `Bearer ${tokenFor(wilson)}`)
            .field('leaveTypeId', slType._id.toString())
            .field('startDate', date.format('YYYY-MM-DD'))
            .field('endDate', date.format('YYYY-MM-DD'))
            .field('reason', 'auto-provision test');

        expect(res.status).toBe(201);
        const after = await LeaveBalance.findOne({ user: wilson._id, leaveType: slType._id, year });
        expect(after).not.toBeNull();
        expect(after.totalDays).toBe(slType.defaultDaysPerYear);
        expect(after.pendingDays).toBe(1);
    });

    test('Leave Without Pay can always be applied for regardless of balance', async () => {
        const lwp = await LeaveType.create({
            name: 'Leave Without Pay',
            code: 'LWP',
            defaultDaysPerYear: 0,
            isPaid: false,
            isUnlimited: true,
            maxDaysAtOnce: 365,
            isActive: true
        });

        const start = nextWeekday(8);
        const end = start.clone().add(9, 'days'); // 10 calendar days, well beyond any "balance"

        const res = await request(app)
            .post('/api/leaves/apply')
            .set('Authorization', `Bearer ${tokenFor(wilson)}`)
            .field('leaveTypeId', lwp._id.toString())
            .field('startDate', start.format('YYYY-MM-DD'))
            .field('endDate', end.format('YYYY-MM-DD'))
            .field('reason', 'LWP always allowed test');

        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe('pending');
    });
});
