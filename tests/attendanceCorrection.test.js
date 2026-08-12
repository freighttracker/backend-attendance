const moment = require('moment-timezone');
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

describe('Requested correction times are interpreted in IST regardless of server timezone', () => {
    // Regression test for a bug where a naive "date + HH:mm" string (as sent
    // by the frontend, with no UTC offset) was parsed with plain `new Date()`
    // - correct only when the Node process's own timezone happens to be IST.
    // On a UTC server (the common case for Docker/cloud deployments) that
    // silently shifted every requested time by +5:30, e.g. an employee typing
    // "10:00" ended up stored as 15:30 IST.
    test('a "10:00" check-in request resolves to 10:00 AM IST, not 10:00 in the server\'s own zone', async () => {
        const date = moment().subtract(3, 'days').format('YYYY-MM-DD');

        const res = await request(app)
            .post('/api/attendance/correction')
            .set('Authorization', `Bearer ${tokenFor(jane)}`)
            .send({ date, requestedCheckIn: `${date}T10:00:00`, reason: 'Forgot to check in' });

        expect(res.status).toBe(201);
        const stored = moment(res.body.data.requestedCheckIn).tz('Asia/Kolkata');
        expect(stored.format('HH:mm')).toBe('10:00');
    });
});

describe('Admin can correct an obviously wrong requested time when approving', () => {
    test('supplying requestedCheckOut on approval overrides the employee\'s original submission', async () => {
        const date = moment().subtract(4, 'days').format('YYYY-MM-DD');

        // Employee accidentally picks AM instead of PM for checkout.
        const applyRes = await request(app)
            .post('/api/attendance/correction')
            .set('Authorization', `Bearer ${tokenFor(jane)}`)
            .send({ date, requestedCheckIn: `${date}T09:00:00`, requestedCheckOut: `${date}T00:17:00`, reason: 'Mis-picked AM/PM' });
        expect(applyRes.status).toBe(201);
        const requestId = applyRes.body.data._id;

        const approveRes = await request(app)
            .put(`/api/attendance/corrections/${requestId}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', requestedCheckOut: `${date}T12:17:00` });

        expect(approveRes.status).toBe(200);
        const corrected = moment(approveRes.body.data.requestedCheckOut).tz('Asia/Kolkata');
        expect(corrected.format('HH:mm')).toBe('12:17');
    });
});
