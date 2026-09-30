const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { AttendanceRecord } = require('../src/models');
const { markMissedCheckoutsAsHalfDay } = require('../src/services/attendance.service');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

let app;
let employee;

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    [employee] = seeded.employees;
});

afterAll(async () => {
    await closeDatabase();
});

test('calendar marks a past check-in without checkout as half day', async () => {
    const missedDate = moment.tz(TZ).subtract(1, 'day').startOf('day');
    while (missedDate.day() === 0 || missedDate.day() === 6) {
        missedDate.subtract(1, 'day');
    }

    const date = missedDate.format('YYYY-MM-DD');
    const recordDate = missedDate.toDate();
    await AttendanceRecord.deleteOne({ user: employee._id, date: recordDate });
    await AttendanceRecord.create({
        user: employee._id,
        date: recordDate,
        checkIn: { time: missedDate.clone().hour(9).minute(0).toDate() },
        status: 'present'
    });

    const response = await request(app)
        .get(`/api/attendance/calendar/${employee._id}?month=${missedDate.month() + 1}&year=${missedDate.year()}`)
        .set('Authorization', `Bearer ${tokenFor(employee)}`);

    expect(response.status).toBe(200);
    const day = response.body.data.days.find((entry) => entry.date === date);
    expect(day.status).toBe('half_day');
    expect(day.checkOut).toBeNull();
    expect(response.body.data.summary.halfDays).toBeGreaterThanOrEqual(1);

    const updatedRecord = await AttendanceRecord.findOne({ user: employee._id, date: recordDate });
    expect(updatedRecord.status).toBe('half_day');
    expect(updatedRecord.isHalfDay).toBe(true);
});

test('does not mark today as half day while its check-in is still in progress', async () => {
    const today = moment.tz(TZ).startOf('day');
    const recordDate = today.toDate();
    await AttendanceRecord.deleteOne({ user: employee._id, date: recordDate });
    await AttendanceRecord.create({
        user: employee._id,
        date: recordDate,
        checkIn: { time: today.clone().hour(9).minute(0).toDate() },
        status: 'present'
    });

    await markMissedCheckoutsAsHalfDay(employee._id);

    const record = await AttendanceRecord.findOne({ user: employee._id, date: recordDate });
    expect(record.status).toBe('present');
    expect(record.isHalfDay).toBe(false);
});
