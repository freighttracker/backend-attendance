const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { LeaveBalance, AttendanceRecord } = require('../src/models');

let app;
let admin;
let jane; // has a pending Casual Leave request
let robert; // has a pending Sick Leave request

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    admin = seeded.admin;
    [, jane, robert] = seeded.employees;
});

afterAll(async () => {
    await closeDatabase();
});

describe('Leave approval workflow', () => {
    test('admin can list pending leave requests awaiting approval', async () => {
        const res = await request(app)
            .get('/api/leaves/all?status=pending')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(2);
        const userIds = res.body.data.map(l => l.user._id);
        expect(userIds).toEqual(expect.arrayContaining([jane._id.toString(), robert._id.toString()]));
    });

    test('a non-admin cannot approve a leave request', async () => {
        const listRes = await request(app)
            .get('/api/leaves/my-leaves')
            .set('Authorization', `Bearer ${tokenFor(jane)}`);
        const pendingLeave = listRes.body.data.find(l => l.status === 'pending');

        const res = await request(app)
            .put(`/api/leaves/${pendingLeave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(jane)}`)
            .send({ status: 'approved' });

        expect(res.status).toBe(403);
    });

    test('admin approving a pending leave marks matching attendance days as on_leave and updates balance', async () => {
        const listRes = await request(app)
            .get('/api/leaves/my-leaves')
            .set('Authorization', `Bearer ${tokenFor(jane)}`);
        const pendingLeave = listRes.body.data.find(l => l.status === 'pending');

        const balanceBefore = await LeaveBalance.findOne({ user: jane._id, leaveType: pendingLeave.leaveType._id });
        expect(balanceBefore.pendingDays).toBeGreaterThanOrEqual(pendingLeave.totalDays);

        const res = await request(app)
            .put(`/api/leaves/${pendingLeave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved' });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('approved');

        const balanceAfter = await LeaveBalance.findOne({ user: jane._id, leaveType: pendingLeave.leaveType._id });
        expect(balanceAfter.usedDays).toBe(balanceBefore.usedDays + pendingLeave.totalDays);
        expect(balanceAfter.pendingDays).toBe(balanceBefore.pendingDays - pendingLeave.totalDays);

        const onLeaveRecords = await AttendanceRecord.find({
            user: jane._id,
            date: { $gte: new Date(pendingLeave.startDate), $lte: new Date(pendingLeave.endDate) }
        });
        expect(onLeaveRecords.every(r => r.status === 'on_leave')).toBe(true);
    });

    test('admin rejecting a pending leave reverts the pending balance', async () => {
        const listRes = await request(app)
            .get('/api/leaves/my-leaves')
            .set('Authorization', `Bearer ${tokenFor(robert)}`);
        const pendingLeave = listRes.body.data.find(l => l.status === 'pending');
        const balanceBefore = await LeaveBalance.findOne({ user: robert._id, leaveType: pendingLeave.leaveType._id });

        const res = await request(app)
            .put(`/api/leaves/${pendingLeave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'rejected', rejectionReason: 'Team is short-staffed that week' });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('rejected');
        expect(res.body.data.rejectionReason).toBe('Team is short-staffed that week');

        const balanceAfter = await LeaveBalance.findOne({ user: robert._id, leaveType: pendingLeave.leaveType._id });
        expect(balanceAfter.pendingDays).toBe(balanceBefore.pendingDays - pendingLeave.totalDays);
        expect(balanceAfter.usedDays).toBe(balanceBefore.usedDays);
    });

    test('approving an already-processed leave request is rejected', async () => {
        const listRes = await request(app)
            .get('/api/leaves/all?status=approved')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        const approvedLeave = listRes.body.data[0];

        const res = await request(app)
            .put(`/api/leaves/${approvedLeave._id}/status`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});
