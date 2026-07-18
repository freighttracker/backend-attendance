const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { AttendanceRecord } = require('../src/models');

let app;
let admin;
let jane; // has a pending correction request (late check-in)

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    admin = seeded.admin;
    [, jane] = seeded.employees;
});

afterAll(async () => {
    await closeDatabase();
});

describe('Attendance correction approval workflow', () => {
    test('admin can list pending correction requests', async () => {
        const res = await request(app)
            .get('/api/attendance/corrections?status=pending')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        expect(res.body.data.length).toBe(2);
    });

    test('a non-admin cannot approve a correction request', async () => {
        const listRes = await request(app)
            .get('/api/attendance/corrections?status=pending')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        const requestId = listRes.body.data[0]._id;

        const res = await request(app)
            .put(`/api/attendance/corrections/${requestId}`)
            .set('Authorization', `Bearer ${tokenFor(jane)}`)
            .send({ status: 'approved' });

        expect(res.status).toBe(403);
    });

    test('approving a correction request updates the underlying attendance record check-in time', async () => {
        const listRes = await request(app)
            .get('/api/attendance/corrections?status=pending')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        const janeRequest = listRes.body.data.find(r => r.user._id === jane._id.toString());
        expect(janeRequest).toBeTruthy();

        const res = await request(app)
            .put(`/api/attendance/corrections/${janeRequest._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved' });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('approved');

        const updatedRecord = await AttendanceRecord.findById(janeRequest.attendanceRecord._id || janeRequest.attendanceRecord);
        expect(new Date(updatedRecord.checkIn.time).toISOString()).toBe(new Date(janeRequest.requestedCheckIn).toISOString());
    });

    test('rejecting a correction request leaves the attendance record unchanged', async () => {
        const listRes = await request(app)
            .get('/api/attendance/corrections?status=pending')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        const remaining = listRes.body.data[0];
        const before = await AttendanceRecord.findById(remaining.attendanceRecord._id || remaining.attendanceRecord);

        const res = await request(app)
            .put(`/api/attendance/corrections/${remaining._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'rejected', rejectionReason: 'No supporting evidence provided' });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('rejected');

        const after = await AttendanceRecord.findById(remaining.attendanceRecord._id || remaining.attendanceRecord);
        expect(after.checkOut?.time?.toString()).toBe(before.checkOut?.time?.toString());
    });
});
