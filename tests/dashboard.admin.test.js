const request = require('supertest');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { connect, closeDatabase, clearDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

let app;
let User;
let AttendanceRecord;

const companyA = new mongoose.Types.ObjectId();
const companyB = new mongoose.Types.ObjectId();

const makeUser = (code, extra = {}) => User.create({
    employeeCode: code,
    email: `${code.toLowerCase()}@example.com`,
    password: 'password123',
    firstName: code,
    lastName: 'Test',
    role: 'employee',
    ...extra
});

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    User = require('../src/models/User');
    AttendanceRecord = require('../src/models/AttendanceRecord');
});

afterEach(async () => {
    await clearDatabase();
});

afterAll(async () => {
    await closeDatabase();
});

describe('GET /api/dashboard/admin', () => {
    test('lists today\'s attendance for every employee in the admin\'s company only', async () => {
        const admin = await makeUser('ADM1', { role: 'company_admin', company: companyA });
        const late = await makeUser('EMP1', { company: companyA, department: 'Ops' });
        const missing = await makeUser('EMP2', { company: companyA, department: 'Ops' });
        const other = await makeUser('EMP3', { company: companyB });

        const now = moment.tz(TZ);
        await AttendanceRecord.create({
            user: late._id,
            company: companyA,
            date: now.clone().startOf('day').toDate(),
            checkIn: { time: now.toDate() },
            status: 'present',
            isLate: true,
            lateMinutes: 12
        });
        await AttendanceRecord.create({
            user: other._id,
            company: companyB,
            date: now.clone().startOf('day').toDate(),
            checkIn: { time: now.toDate() },
            status: 'present'
        });

        const res = await request(app)
            .get('/api/dashboard/admin')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        const { summary, employees, trend, departments } = res.body.data;

        expect(employees.map((e) => e.employeeCode).sort()).toEqual(['EMP1', 'EMP2']);
        const lateRow = employees.find((e) => e.employeeCode === 'EMP1');
        expect(lateRow).toMatchObject({ status: 'present', isLate: true, lateMinutes: 12, isWorking: true });

        const missingRow = employees.find((e) => String(e._id) === String(missing._id));
        expect(['not_checked_in', 'weekend', 'holiday']).toContain(missingRow.status);

        expect(summary.totalEmployees).toBe(2);
        expect(summary.present).toBe(1);
        expect(summary.late).toBe(1);
        expect(summary.working).toBe(1);
        expect(trend).toHaveLength(7);
        expect(trend[6].present).toBe(1);
        expect(departments).toEqual([{ department: 'Ops', total: 2, present: 1 }]);
    });

    test('a plain employee is forbidden', async () => {
        const employee = await makeUser('EMP9', { company: companyA });
        const res = await request(app)
            .get('/api/dashboard/admin')
            .set('Authorization', `Bearer ${tokenFor(employee)}`);
        expect(res.status).toBe(403);
    });
});
