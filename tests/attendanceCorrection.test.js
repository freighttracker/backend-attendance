const moment = require('moment-timezone');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { AttendanceRecord } = require('../src/models');

let app;
let admin;
let jane; // has a pending correction request (late check-in)
let robert;

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

describe('Admin can directly force a Full Day/Half Day status when approving, overriding the hours-based calculation', () => {
    test('overrideStatus wins even though the requested times alone would compute to Half Day', async () => {
        const date = moment().subtract(5, 'days').format('YYYY-MM-DD');

        // 9:00 to 12:00 is 3 working hours - normally that lands in the Half
        // Day band (>= absentThresholdHours(2), < fullDayHours(8)).
        const applyRes = await request(app)
            .post('/api/attendance/correction')
            .set('Authorization', `Bearer ${tokenFor(robert)}`)
            .send({ date, requestedCheckIn: `${date}T09:00:00`, requestedCheckOut: `${date}T12:00:00`, reason: 'Left early for a client emergency, manager approved full credit' });
        expect(applyRes.status).toBe(201);
        const requestId = applyRes.body.data._id;

        const approveRes = await request(app)
            .put(`/api/attendance/corrections/${requestId}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', overrideStatus: 'present' });

        expect(approveRes.status).toBe(200);

        const record = await AttendanceRecord.findOne({ user: robert._id, date: moment.tz(date, 'Asia/Kolkata').startOf('day').toDate() });
        expect(record.status).toBe('present');
        expect(record.isHalfDay).toBe(false);
        expect(record.isCorrected).toBe(true);
        expect(record.correctedBy.toString()).toBe(admin._id.toString());
        expect(record.previousStatus).toBeDefined();
    });

    test('an invalid overrideStatus value is rejected', async () => {
        const date = moment().subtract(6, 'days').format('YYYY-MM-DD');
        const applyRes = await request(app)
            .post('/api/attendance/correction')
            .set('Authorization', `Bearer ${tokenFor(robert)}`)
            .send({ date, requestedCheckIn: `${date}T09:00:00`, requestedCheckOut: `${date}T12:00:00`, reason: 'Testing invalid override' });
        const requestId = applyRes.body.data._id;

        const res = await request(app)
            .put(`/api/attendance/corrections/${requestId}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', overrideStatus: 'not-a-real-status' });

        expect(res.status).toBe(400);
    });
});

describe('Admin direct attendance correction (PUT /api/attendance/correct) - no pre-existing employee request needed', () => {
    test('a non-admin cannot use the direct-correction endpoint', async () => {
        const date = moment().subtract(7, 'days').format('YYYY-MM-DD');
        const res = await request(app)
            .put('/api/attendance/correct')
            .set('Authorization', `Bearer ${tokenFor(robert)}`)
            .send({ userId: robert._id.toString(), date, status: 'present', reason: 'Attempted self-correction' });

        expect(res.status).toBe(403);
    });

    test('reason is required', async () => {
        const date = moment().subtract(7, 'days').format('YYYY-MM-DD');
        const res = await request(app)
            .put('/api/attendance/correct')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ userId: robert._id.toString(), date, status: 'present' });

        expect(res.status).toBe(400);
    });

    test('correcting the exact check-in/check-out time recalculates the day as a Full Day', async () => {
        const date = moment().subtract(8, 'days').format('YYYY-MM-DD');

        const res = await request(app)
            .put('/api/attendance/correct')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({
                userId: robert._id.toString(),
                date,
                checkInTime: `${date}T09:00:00`,
                checkOutTime: `${date}T18:00:00`,
                reason: 'Biometric device was down all day, confirmed via security log'
            });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('present');
        expect(res.body.data.workingHours).toBeCloseTo(9, 1);
        expect(res.body.data.isCorrected).toBe(true);
    });

    test('forcing a status directly (no time given) counts the day as Half Day without touching working hours', async () => {
        const date = moment().subtract(9, 'days').format('YYYY-MM-DD');

        // First give the day a normal Full Day via a real time correction.
        await request(app)
            .put('/api/attendance/correct')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({
                userId: robert._id.toString(),
                date,
                checkInTime: `${date}T09:00:00`,
                checkOutTime: `${date}T18:00:00`,
                reason: 'Initial correction'
            });

        // Admin then decides, independent of the clocked hours, that this
        // day should only count as a Half Day (e.g. employee left on
        // approved personal business for the afternoon).
        const res = await request(app)
            .put('/api/attendance/correct')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ userId: robert._id.toString(), date, status: 'half_day', reason: 'Left for approved personal business in the afternoon' });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('half_day');
        expect(res.body.data.isHalfDay).toBe(true);
        expect(res.body.data.workingHours).toBeCloseTo(9, 1); // untouched by the status override

        const record = await AttendanceRecord.findById(res.body.data._id);
        expect(record.correctionReason).toBe('Left for approved personal business in the afternoon');
    });

    test('a locked attendance record cannot be corrected', async () => {
        const date = moment().subtract(10, 'days').format('YYYY-MM-DD');

        await request(app)
            .put('/api/attendance/correct')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ userId: robert._id.toString(), date, checkInTime: `${date}T09:00:00`, checkOutTime: `${date}T18:00:00`, reason: 'Setup' });

        await request(app)
            .post('/api/attendance/lock')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ startDate: date, endDate: date });

        const res = await request(app)
            .put('/api/attendance/correct')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ userId: robert._id.toString(), date, status: 'present', reason: 'Trying to edit after lock' });

        expect(res.status).toBe(400);
    });
});
