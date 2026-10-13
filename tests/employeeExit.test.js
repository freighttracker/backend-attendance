const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { User, AttendanceRecord, LeaveRequest, LeaveType } = require('../src/models');
const { getMonthlyAttendanceSummary, calculateSalary } = require('../src/services/payroll.service');

let app;
let admin;
let john;

// Seed data covers last month, so the employee leaves on its 15th.
const seedMonthStart = moment().subtract(1, 'month').startOf('month');
const month = seedMonthStart.month() + 1;
const year = seedMonthStart.year();
const leavingDate = seedMonthStart.clone().date(15).format('YYYY-MM-DD');

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    admin = seeded.admin;
    [john] = seeded.employees;
});

afterAll(async () => {
    await closeDatabase();
});

describe('Employee exit - records are kept, nothing counts after the last working day', () => {
    let before;
    let recordCountBefore;
    let pendingLeave;

    test('exit summary works as a preview before the employee is marked left', async () => {
        before = await getMonthlyAttendanceSummary(john._id, month, year);
        recordCountBefore = await AttendanceRecord.countDocuments({ user: john._id });

        const leaveType = await LeaveType.findOne({ isActive: true });
        const start = moment().add(10, 'days').startOf('day');
        pendingLeave = await LeaveRequest.create({
            user: john._id,
            leaveType: leaveType._id,
            startDate: start.toDate(),
            endDate: start.toDate(),
            totalDays: 1,
            reason: 'Planned leave',
            status: 'pending'
        });

        const res = await request(app)
            .get(`/api/users/${john._id}/exit-summary`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(res.status).toBe(200);
        expect(res.body.data.hasLeft).toBe(false);
        expect(res.body.data.openItems.leaveRequests).toBeGreaterThanOrEqual(1);
    });

    test('marking left deactivates, stores exit details and cancels pending leave', async () => {
        const res = await request(app)
            .put(`/api/users/${john._id}/left`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ leavingDate, reason: 'Moved cities', exitType: 'resigned' });
        expect(res.status).toBe(200);
        expect(res.body.data.isActive).toBe(false);
        expect(res.body.data.exitType).toBe('resigned');
        expect(res.body.data.cleanup.cancelledLeaves).toBeGreaterThanOrEqual(1);

        const leave = await LeaveRequest.findById(pendingLeave._id);
        expect(leave.status).toBe('cancelled');
    });

    test('rejects an unknown exit type', async () => {
        const [, jane] = await User.find({ role: 'employee', isActive: true }).limit(2);
        const res = await request(app)
            .put(`/api/users/${(jane || john)._id}/left`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ leavingDate, exitType: 'vanished' });
        expect(res.status).toBe(400);
    });

    test('every attendance record is still there', async () => {
        expect(await AttendanceRecord.countDocuments({ user: john._id })).toBe(recordCountBefore);
    });

    test('final month stops at the last working day - later days are neither paid nor absent', async () => {
        const after = await getMonthlyAttendanceSummary(john._id, month, year);
        const expectedNotEmployed = after.daysInMonth - 15;

        expect(after.notEmployedDays).toBe(expectedNotEmployed);
        expect(after.weeklyOffs).toBeLessThan(before.weeklyOffs);
        expect(after.workingDays).toBeLessThan(before.workingDays);
        expect(after.absentDays).toBeLessThanOrEqual(before.absentDays);

        const salary = await calculateSalary(john._id, month, year);
        const proration = salary.deductions.find((d) => d.key === 'exitProration');
        expect(proration).toBeDefined();
        expect(proration.amount).toBeCloseTo(salary.perDaySalary * expectedNotEmployed, 0);
    });

    test('the month after leaving has no payable or absent days at all', async () => {
        const next = seedMonthStart.clone().add(1, 'month');
        const summary = await getMonthlyAttendanceSummary(john._id, next.month() + 1, next.year());
        expect(summary.notEmployedDays).toBe(summary.daysInMonth);
        expect(summary.workingDays).toBe(0);
        expect(summary.absentDays).toBe(0);
        expect(summary.weeklyOffs).toBe(0);
    });

    test('exit summary reports the last working day after exit', async () => {
        const res = await request(app)
            .get(`/api/users/${john._id}/exit-summary`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(res.status).toBe(200);
        expect(res.body.data.hasLeft).toBe(true);
        expect(res.body.data.exitType).toBe('resigned');
        expect(res.body.data.finalMonth.month).toBe(month);
        expect(res.body.data.finalMonth.daysAfterLastWorkingDay).toBe(res.body.data.finalMonth.daysInMonth - 15);
        expect(res.body.data.openItems.leaveRequests).toBe(0);
    });

    test('rejoin makes the full month count again', async () => {
        const res = await request(app)
            .put(`/api/users/${john._id}/rejoin`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(res.status).toBe(200);
        expect(res.body.data.isActive).toBe(true);

        const summary = await getMonthlyAttendanceSummary(john._id, month, year);
        expect(summary.notEmployedDays).toBe(0);
        expect(summary.weeklyOffs).toBe(before.weeklyOffs);
    });
});
