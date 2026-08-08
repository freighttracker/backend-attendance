const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { LeaveBalance, LeaveType, AttendanceRecord } = require('../src/models');

let app;
let admin;
let wilson;

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

function nextWeekday(monthsAhead) {
    const date = moment().add(monthsAhead, 'months').startOf('month');
    while (date.day() === 0 || date.day() === 6) date.add(1, 'day');
    return date;
}

async function applyLeave(code, monthsAhead, days = 1) {
    const leaveType = await LeaveType.findOne({ code });
    const start = nextWeekday(monthsAhead);
    const end = start.clone().add(days - 1, 'days');

    const res = await request(app)
        .post('/api/leaves/apply')
        .set('Authorization', `Bearer ${tokenFor(wilson)}`)
        .field('leaveTypeId', leaveType._id.toString())
        .field('startDate', start.format('YYYY-MM-DD'))
        .field('endDate', end.format('YYYY-MM-DD'))
        .field('reason', 'admin actions test');

    return { leave: res.body.data, leaveType, start, end };
}

describe('Admin cancel and edit actions', () => {
    test('a non-admin cannot edit a leave request or adjust a balance', async () => {
        const { leave } = await applyLeave('CL', 10);

        const editRes = await request(app)
            .put(`/api/leaves/${leave._id}`)
            .set('Authorization', `Bearer ${tokenFor(wilson)}`)
            .send({ remarks: 'trying to self-edit' });
        expect(editRes.status).toBe(403);

        const adjustRes = await request(app)
            .post('/api/leaves/balances')
            .set('Authorization', `Bearer ${tokenFor(wilson)}`)
            .send({ userId: wilson._id.toString(), leaveTypeId: leave.leaveType, year: moment().year(), totalDays: 99 });
        expect(adjustRes.status).toBe(403);
    });

    test('admin cancelling a pending leave restores pendingDays', async () => {
        const { leave, leaveType } = await applyLeave('SL', 11);
        const year = moment().add(11, 'months').year();
        const before = await LeaveBalance.findOne({ user: wilson._id, leaveType: leaveType._id, year });

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/cancel`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send();

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('cancelled');
        const after = await LeaveBalance.findOne({ user: wilson._id, leaveType: leaveType._id, year });
        expect(after.pendingDays).toBe(before.pendingDays - leave.totalDays);
    });

    test('admin cancelling an approved leave restores usedDays and un-marks attendance', async () => {
        const { leave, leaveType, start, end } = await applyLeave('CL', 12, 2);
        const year = moment().add(12, 'months').year();

        const approveRes = await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'unpaid' });
        expect(approveRes.status).toBe(200);

        const marked = await AttendanceRecord.find({
            user: wilson._id,
            date: { $gte: start.toDate(), $lte: end.toDate() }
        });
        expect(marked.every((r) => r.status === 'on_leave')).toBe(true);

        const balanceBefore = await LeaveBalance.findOne({ user: wilson._id, leaveType: leaveType._id, year });

        const cancelRes = await request(app)
            .put(`/api/leaves/${leave._id}/cancel`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send();

        expect(cancelRes.status).toBe(200);
        expect(cancelRes.body.data.status).toBe('cancelled');

        const balanceAfter = await LeaveBalance.findOne({ user: wilson._id, leaveType: leaveType._id, year });
        expect(balanceAfter.usedDays).toBe(balanceBefore.usedDays - leave.totalDays);

        const afterAttendance = await AttendanceRecord.find({
            user: wilson._id,
            date: { $gte: start.toDate(), $lte: end.toDate() }
        });
        expect(afterAttendance.some((r) => r.status === 'on_leave')).toBe(false);
    });

    test('an employee cannot cancel their own approved leave (admin-only)', async () => {
        const { leave } = await applyLeave('SL', 13);
        await request(app)
            .put(`/api/leaves/${leave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', paidStatus: 'paid' });

        const res = await request(app)
            .put(`/api/leaves/${leave._id}/cancel`)
            .set('Authorization', `Bearer ${tokenFor(wilson)}`)
            .send();

        expect(res.status).toBe(403);
    });

    test('admin editing a pending leave request reconciles the balance for the new day count', async () => {
        const { leave, leaveType } = await applyLeave('CL', 14, 1);
        const year = moment().add(14, 'months').year();
        const before = await LeaveBalance.findOne({ user: wilson._id, leaveType: leaveType._id, year });

        const newStart = nextWeekday(14).add(7, 'days');
        if (newStart.day() === 5) newStart.add(3, 'days'); // Friday -> next Monday, so newEnd stays a weekday too
        const newEnd = newStart.clone().add(1, 'days');

        const res = await request(app)
            .put(`/api/leaves/${leave._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ startDate: newStart.format('YYYY-MM-DD'), endDate: newEnd.format('YYYY-MM-DD'), remarks: 'extended by admin' });

        expect(res.status).toBe(200);
        expect(res.body.data.totalDays).toBe(2);
        expect(res.body.data.remarks).toBe('extended by admin');

        const after = await LeaveBalance.findOne({ user: wilson._id, leaveType: leaveType._id, year });
        expect(after.pendingDays).toBe(before.pendingDays - leave.totalDays + 2);
    });
});
