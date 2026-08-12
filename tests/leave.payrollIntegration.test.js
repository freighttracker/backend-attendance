const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { AttendanceRecord, LeaveRequest, LeaveType, Holiday } = require('../src/models');

let app;
let admin;
let john;
let wilson;

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    admin = seeded.admin;
    [john] = seeded.employees;
    wilson = seeded.employees[4];
});

afterAll(async () => {
    await closeDatabase();
});

describe('Payroll trusts LeaveRequest.paidStatus for the LOP calculation', () => {
    const seedMonthStart = moment().subtract(1, 'month').startOf('month');
    const month = seedMonthStart.month() + 1;
    const year = seedMonthStart.year();

    test('an approved unpaid leave day increments unpaidLeaveDays and produces a leave deduction line', async () => {
        // Pick a day the seeder marked 'present' in the first half of the
        // month (John's own approved-paid leave already occupies days 15-16).
        const presentRecord = await AttendanceRecord.findOne({
            user: john._id,
            status: 'present',
            date: { $gte: seedMonthStart.toDate(), $lt: seedMonthStart.clone().date(10).toDate() }
        });
        expect(presentRecord).not.toBeNull();

        const cl = await LeaveType.findOne({ code: 'CL' });
        await LeaveRequest.create({
            user: john._id,
            leaveType: cl._id,
            startDate: presentRecord.date,
            endDate: presentRecord.date,
            totalDays: 1,
            reason: 'Unpaid day off (test fixture)',
            status: 'approved',
            paidStatus: 'unpaid',
            approvedBy: admin._id,
            approvedAt: new Date()
        });
        presentRecord.status = 'on_leave';
        await presentRecord.save();

        const res = await request(app)
            .post('/api/payroll/generate')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ userId: john._id.toString(), month, year });

        expect(res.status).toBe(201);
        const summary = res.body.data.slip.attendanceSummary;
        expect(summary.unpaidLeaveDays).toBeGreaterThanOrEqual(1);

        const leaveDeduction = res.body.data.slip.deductions.find((d) => d.key === 'leaveDeduction');
        expect(leaveDeduction).toBeTruthy();
        expect(leaveDeduction.amount).toBeGreaterThan(0);
    });
});

describe('Payroll only deducts the unpaid share of a partially-paid leave', () => {
    const seedMonthStart = moment().subtract(1, 'month').startOf('month');
    const month = seedMonthStart.month() + 1;
    const year = seedMonthStart.year();

    // Finds 5 consecutive weekdays with no seeded holiday, avoiding wilson's
    // one seeded absence day (day 16) so the deduction math below is
    // attributable entirely to this test's own partial leave request.
    async function findCleanFiveDayWindow() {
        const daysInMonth = seedMonthStart.clone().endOf('month').date();
        const holidays = await Holiday.find({
            isActive: true,
            date: { $gte: seedMonthStart.toDate(), $lte: seedMonthStart.clone().endOf('month').toDate() }
        });
        const holidayDays = new Set(holidays.map((h) => moment(h.date).date()));

        for (let start = 2; start + 4 <= daysInMonth; start++) {
            let ok = true;
            for (let offset = 0; offset < 5; offset++) {
                const day = start + offset;
                const date = seedMonthStart.clone().date(day);
                if (date.day() === 0 || date.day() === 6) { ok = false; break; }
                if (holidayDays.has(day) || day === 16) { ok = false; break; }
            }
            if (ok) {
                return { start: seedMonthStart.clone().date(start), end: seedMonthStart.clone().date(start + 4) };
            }
        }
        throw new Error('No clean 5-weekday window found in seed month');
    }

    test('3 paid + 2 unpaid days deducts only 2 days worth of salary', async () => {
        const { start, end } = await findCleanFiveDayWindow();

        // Wilson has one deterministically-seeded 'absent' day elsewhere in
        // the month (day 16) that would otherwise add its own unrelated LOP
        // deduction on top of this leave's - neutralize it so the deduction
        // asserted below is attributable entirely to this partial leave.
        await AttendanceRecord.updateOne(
            { user: wilson._id, date: seedMonthStart.clone().date(16).startOf('day').toDate() },
            { $set: { status: 'present' } }
        );

        const cl = await LeaveType.findOne({ code: 'CL' });
        await LeaveRequest.create({
            user: wilson._id,
            leaveType: cl._id,
            startDate: start.toDate(),
            endDate: end.toDate(),
            totalDays: 5,
            reason: 'Partial paid/unpaid leave (test fixture)',
            status: 'approved',
            paidStatus: 'partial',
            paidDays: 3,
            unpaidDays: 2,
            approvedBy: admin._id,
            approvedAt: new Date()
        });

        const cursor = start.clone();
        while (cursor.isSameOrBefore(end, 'day')) {
            await AttendanceRecord.findOneAndUpdate(
                { user: wilson._id, date: cursor.clone().startOf('day').toDate() },
                { user: wilson._id, date: cursor.clone().startOf('day').toDate(), status: 'on_leave' },
                { upsert: true, new: true }
            );
            cursor.add(1, 'day');
        }

        const res = await request(app)
            .post('/api/payroll/generate')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ userId: wilson._id.toString(), month, year });

        expect(res.status).toBe(201);
        const slip = res.body.data.slip;

        // At least 3 of this leave's days landed as paid and 2 as unpaid -
        // >= rather than === since other unrelated days in the month may
        // also independently resolve to paid/unpaid leave.
        expect(slip.attendanceSummary.paidLeaveDays).toBeGreaterThanOrEqual(3);
        expect(slip.attendanceSummary.unpaidLeaveDays).toBeGreaterThanOrEqual(2);

        const leaveDeduction = slip.deductions.find((d) => d.key === 'leaveDeduction');
        expect(leaveDeduction).toBeTruthy();
        // Exactly 2 unpaid days from this leave, and no other unrelated
        // absences in the clean window we picked, so the deduction should be
        // bounded to roughly 2 days' worth - proving the 3 paid days were
        // not deducted.
        const twoDaySalary = slip.perDaySalary * 2;
        expect(leaveDeduction.amount).toBeGreaterThanOrEqual(twoDaySalary - 0.01);
        expect(leaveDeduction.amount).toBeLessThan(slip.perDaySalary * 3);
    });
});
