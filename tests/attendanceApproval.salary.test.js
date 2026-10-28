const moment = require('moment-timezone');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

let app;
let admin;
let john;
let AttendanceRecord;
let SalarySlip;

// The seeder gives every employee a month of attendance for last month.
const seedMonthStart = moment.tz(TZ).subtract(1, 'month').startOf('month');
const month = seedMonthStart.month() + 1;
const year = seedMonthStart.year();
const monthRange = { $gte: seedMonthStart.toDate(), $lte: seedMonthStart.clone().endOf('month').toDate() };

const getSlip = () => SalarySlip.findOne({ user: john._id, month, year }).lean();
const earning = (slip, key) => (slip.earnings || []).find((e) => e.key === key)?.amount || 0;

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    AttendanceRecord = require('../src/models/AttendanceRecord');
    SalarySlip = require('../src/models/SalarySlip');
    const seeded = await seedData();
    admin = seeded.admin;
    [john] = seeded.employees;

    // Known starting point: one half day, exactly three (pending) lates -
    // enough to hit the default 3-late = 0.5 day policy tier.
    await AttendanceRecord.updateMany({ user: john._id, date: monthRange, status: 'half_day' }, { $set: { status: 'present', isHalfDay: false } });
    await AttendanceRecord.updateMany({ user: john._id, date: monthRange }, { $set: { isLate: false, lateStatus: 'pending' } });
    const present = await AttendanceRecord.find({ user: john._id, date: monthRange, status: 'present' }).sort({ date: 1 });
    expect(present.length).toBeGreaterThanOrEqual(4);
    await AttendanceRecord.updateOne({ _id: present[0]._id }, { $set: { status: 'half_day', isHalfDay: true, halfDayStatus: 'pending' } });
    await AttendanceRecord.updateMany(
        { _id: { $in: present.slice(1, 4).map((r) => r._id) } },
        { $set: { isLate: true, lateMinutes: 20, lateStatus: 'pending' } }
    );

    const gen = await request(app)
        .post('/api/payroll/generate')
        .set('Authorization', `Bearer ${tokenFor(admin)}`)
        .send({ userId: john._id.toString(), month, year });
    expect(gen.status).toBe(201);
});

afterAll(async () => {
    await closeDatabase();
});

describe('Admin attendance approvals flow into salary', () => {
    test('approving a half day pays it as a full day and refreshes the slip', async () => {
        const before = await getSlip();
        expect(before.attendanceSummary.halfDays).toBe(1);

        const list = await request(app)
            .get(`/api/attendance/half-day?month=${month}&year=${year}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(list.status).toBe(200);
        const record = list.body.data.find((r) => String(r.user._id) === String(john._id));
        expect(record).toBeTruthy();

        const res = await request(app)
            .put(`/api/attendance/half-day/${record._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved', remarks: 'Client visit' });
        expect(res.status).toBe(200);
        expect(res.body.data.halfDayStatus).toBe('approved');
        expect(res.body.data.salary.updated).toBe(true);

        const after = await getSlip();
        expect(after.attendanceSummary.halfDays).toBe(0);
        expect(after.attendanceSummary.approvedHalfDays).toBe(1);
        expect(after.attendanceSummary.presentDays).toBe(before.attendanceSummary.presentDays + 1);
        expect(after.netSalary).toBeCloseTo(before.netSalary + before.perDaySalary / 2, 0);
        // Regenerating must keep the bonus already on the slip.
        expect(earning(before, 'bonus')).toBeGreaterThan(0);
        expect(earning(after, 'bonus')).toBe(earning(before, 'bonus'));
    });

    test('approving a late arrival drops it below the late-deduction threshold', async () => {
        const before = await getSlip();
        expect(before.attendanceSummary.lateCount).toBe(3);
        expect(before.attendanceSummary.lateDeductionUnits).toBe(0.5);

        const late = await AttendanceRecord.findOne({ user: john._id, date: monthRange, isLate: true });
        const res = await request(app)
            .put(`/api/attendance/late/${late._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved' });
        expect(res.status).toBe(200);
        expect(res.body.data.salary.updated).toBe(true);

        const after = await getSlip();
        expect(after.attendanceSummary.lateCount).toBe(2);
        expect(after.attendanceSummary.lateDeductionUnits).toBe(0);
        expect(after.netSalary).toBeCloseTo(before.netSalary + before.perDaySalary * 0.5, 0);
    });

    test('a slip that is no longer in generated status is left alone and the admin is told', async () => {
        await SalarySlip.updateOne({ user: john._id, month, year }, { $set: { status: 'published' } });
        const late = await AttendanceRecord.findOne({ user: john._id, date: monthRange, isLate: true, lateStatus: 'pending' });
        const before = await getSlip();

        const res = await request(app)
            .put(`/api/attendance/late/${late._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ status: 'approved' });
        expect(res.status).toBe(200);
        expect(res.body.data.salary.updated).toBe(false);
        expect(res.body.data.salary.message).toMatch(/published/);
        expect((await getSlip()).netSalary).toBe(before.netSalary);
    });

    test('changing the day\'s status voids an earlier half-day approval', async () => {
        const record = await AttendanceRecord.findOne({ user: john._id, date: monthRange, halfDayStatus: 'approved' });
        record.status = 'present';
        await record.save();
        record.status = 'half_day';
        await record.save();
        expect((await AttendanceRecord.findById(record._id)).halfDayStatus).toBe('pending');
    });
});
