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
// per call keeps each test's leave request from overlapping another's. Must
// land on Monday specifically (not just any weekday) so a multi-day request
// built from it (start + N-1 days) stays a clean run of working days instead
// of clipping the following weekend.
function nextWeekday(monthsAhead) {
    const date = moment().add(monthsAhead, 'months').startOf('month');
    while (date.day() !== 1) date.add(1, 'day');
    return date;
}

async function applyLeave(user, code, monthsAhead, days = 1) {
    const typesRes = await request(app)
        .get('/api/leaves/types')
        .set('Authorization', `Bearer ${tokenFor(user)}`);
    const leaveType = typesRes.body.data.find((t) => t.code === code);
    const start = nextWeekday(monthsAhead);
    const end = start.clone().add(days - 1, 'days');

    const res = await request(app)
        .post('/api/leaves/apply')
        .set('Authorization', `Bearer ${tokenFor(user)}`)
        .field('leaveTypeId', leaveType._id)
        .field('startDate', start.format('YYYY-MM-DD'))
        .field('endDate', end.format('YYYY-MM-DD'))
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

    test('approving with paidStatus:"paid" sets paidDays = totalDays and unpaidDays = 0', async () => {
        const leave = await applyLeave(wilson, 'SL', 6, 3);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'paid' });

        expect(res.status).toBe(200);
        expect(res.body.data.paidDays).toBe(leave.totalDays);
        expect(res.body.data.unpaidDays).toBe(0);
    });

    test('approving with paidStatus:"unpaid" sets paidDays = 0 and unpaidDays = totalDays', async () => {
        const leave = await applyLeave(wilson, 'CL', 7, 3);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'unpaid' });

        expect(res.status).toBe(200);
        expect(res.body.data.paidDays).toBe(0);
        expect(res.body.data.unpaidDays).toBe(leave.totalDays);
    });

    test('approving as partial requires paidDays + unpaidDays to equal totalDays', async () => {
        // EL (15 days/year) rather than SL - by this point SL's 10/year
        // balance is already spoken for by the earlier SL tests above.
        const leave = await applyLeave(wilson, 'EL', 8, 5);
        expect(leave.totalDays).toBe(5);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'partial', paidDays: 3, unpaidDays: 1 });

        expect(res.status).toBe(400);
    });

    test('approving as partial with a valid split persists paidDays/unpaidDays', async () => {
        const leave = await applyLeave(wilson, 'CL', 9, 5);
        expect(leave.totalDays).toBe(5);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'partial', paidDays: 3, unpaidDays: 2, remarks: 'split approved' });

        expect(res.status).toBe(200);
        expect(res.body.data.paidStatus).toBe('partial');
        expect(res.body.data.paidDays).toBe(3);
        expect(res.body.data.unpaidDays).toBe(2);
        expect(res.body.data.remarks).toBe('split approved');
    });

    test('partial approval missing paidDays/unpaidDays is rejected', async () => {
        const leave = await applyLeave(wilson, 'EL', 10, 5);

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'partial' });

        expect(res.status).toBe(400);
    });
});
