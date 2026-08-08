const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');

let app;
let admin;
let wilson; // no pre-existing leave requests in the seed, safe to use fresh

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    admin = seeded.admin;
    wilson = seeded.employees[4];
});

afterAll(async () => {
    await closeDatabase();
});

// Monday of the Nth future month - guaranteed weekday, and a different month
// per call keeps each test's leave request from overlapping another's.
function nextWeekday(monthsAhead) {
    const date = moment().add(monthsAhead, 'months').startOf('month');
    while (date.day() === 0 || date.day() === 6) date.add(1, 'day');
    return date;
}

async function applyLeave(user, code, monthsAhead) {
    const typesRes = await request(app)
        .get('/api/leaves/types')
        .set('Authorization', `Bearer ${tokenFor(user)}`);
    const leaveType = typesRes.body.data.find((t) => t.code === code);
    const date = nextWeekday(monthsAhead);

    const res = await request(app)
        .post('/api/leaves/apply')
        .set('Authorization', `Bearer ${tokenFor(user)}`)
        .field('leaveTypeId', leaveType._id)
        .field('startDate', date.format('YYYY-MM-DD'))
        .field('endDate', date.format('YYYY-MM-DD'))
        .field('reason', 'paidStatus test');

    return res.body.data;
}

describe('Admin paid/unpaid override on approval', () => {
    test('approving without paidStatus is rejected', async () => {
        const leave = await applyLeave(wilson, 'CL', 2);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('approving with paidStatus:"paid" persists paid even though the leave type is unpaid by default', async () => {
        const leave = await applyLeave(wilson, 'SL', 3);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'paid', remarks: 'Approved as goodwill' });

        expect(res.status).toBe(200);
        expect(res.body.data.paidStatus).toBe('paid');
        expect(res.body.data.remarks).toBe('Approved as goodwill');
    });

    test('approving with paidStatus:"unpaid" persists unpaid', async () => {
        const leave = await applyLeave(wilson, 'CL', 4);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'unpaid' });

        expect(res.status).toBe(200);
        expect(res.body.data.paidStatus).toBe('unpaid');
    });

    test('an invalid paidStatus value is rejected', async () => {
        const leave = await applyLeave(wilson, 'CL', 5);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'sometimes' });

        expect(res.status).toBe(400);
    });
});
