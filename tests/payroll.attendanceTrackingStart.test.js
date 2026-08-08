const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { AttendanceRecord, SystemSetting } = require('../src/models');
const { getMonthlyAttendanceSummary } = require('../src/services/payroll.service');

let app;
let admin;
let john;

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    admin = seeded.admin;
    [john] = seeded.employees;

    // Wipe John's entire attendance for the seeded month, simulating "this
    // employee was never tracked at all that month" - no records anywhere.
    const seedMonthStart = moment().subtract(1, 'month').startOf('month');
    const seedMonthEnd = seedMonthStart.clone().endOf('month');
    await AttendanceRecord.deleteMany({
        user: john._id,
        date: { $gte: seedMonthStart.toDate(), $lte: seedMonthEnd.toDate() }
    });
});

afterAll(async () => {
    await closeDatabase();
});

describe('Attendance tracking start date - pre-rollout days are paid, not LOP', () => {
    const seedMonthStart = moment().subtract(1, 'month').startOf('month');
    const month = seedMonthStart.month() + 1;
    const year = seedMonthStart.year();
    const midMonthCutoff = seedMonthStart.clone().date(15).format('YYYY-MM-DD');

    test('without the setting, every unrecorded working day counts as absent/LOP (existing behavior)', async () => {
        const summary = await getMonthlyAttendanceSummary(john._id, month, year);
        expect(summary.presentDays).toBe(0);
        expect(summary.absentDays).toBeGreaterThan(0);
        expect(summary.unpaidLeaveDays).toBe(summary.absentDays);
    });

    test('PUT /api/payroll/settings accepts attendanceTrackingStartDate and GET reflects it', async () => {
        const putRes = await request(app)
            .put('/api/payroll/settings')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ attendanceTrackingStartDate: midMonthCutoff });
        expect(putRes.status).toBe(200);
        expect(putRes.body.data.attendanceTrackingStartDate).toBe(midMonthCutoff);

        const getRes = await request(app)
            .get('/api/payroll/settings')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(getRes.body.data.attendanceTrackingStartDate).toBe(midMonthCutoff);
    });

    test('with the setting in place, days before the cutoff become present and days after stay absent', async () => {
        await SystemSetting.findOneAndUpdate(
            { settingKey: 'attendance_tracking_start_date' },
            { settingValue: midMonthCutoff, settingType: 'string' },
            { upsert: true }
        );

        const summary = await getMonthlyAttendanceSummary(john._id, month, year);
        expect(summary.presentDays).toBeGreaterThan(0);
        expect(summary.absentDays).toBeGreaterThan(0); // days on/after the cutoff are still LOP
        expect(summary.unpaidLeaveDays).toBe(summary.absentDays);
    });
});
