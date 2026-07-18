const moment = require('moment');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');

let app;
let admin;
let john;

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

describe('Payroll module (reconciled with frontend contract)', () => {
    // The seeder gives every employee a salary structure and a month of attendance
    // for last calendar month (plus a bonus/reimbursement/loan for that same month) -
    // reuse that month so payroll generation has real data to compute against.
    const seedMonthStart = moment().subtract(1, 'month').startOf('month');
    const month = seedMonthStart.month() + 1;
    const year = seedMonthStart.year();

    test('salary structure lives under /api/payroll/salary-structures (seeder already created one, so this revises it)', async () => {
        const put = await request(app)
            .put(`/api/payroll/salary-structures/${john._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({
                monthlyGrossSalary: 60000,
                annualCTC: 720000,
                earnings: { basicSalary: { calculationType: 'percentage', value: 40, baseComponent: 'monthlyGrossSalary', isEnabled: true } }
            });
        expect(put.status).toBe(200);
        expect(put.body.data.monthlyGrossSalary).toBe(60000);

        const get = await request(app)
            .get(`/api/payroll/salary-structures/${john._id}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(get.status).toBe(200);
        expect(get.body.data.annualCTC).toBe(720000);

        const list = await request(app)
            .get('/api/payroll/salary-structures')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(list.status).toBe(200);
        expect(list.body.data.length).toBeGreaterThan(0);
    });

    test('unified POST /api/payroll/generate dispatches to single-employee generation when userId is present', async () => {
        const res = await request(app)
            .post('/api/payroll/generate')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ userId: john._id.toString(), month, year });

        expect(res.status).toBe(201);
        expect(res.body.data.slip.user).toBe(john._id.toString());
        expect(res.body.data.slip.month).toBe(month);
        expect(res.body.data.payroll.scope).toBe('employee');
    });

    test('GET /api/payroll/reports returns a summary and the generated slip', async () => {
        const res = await request(app)
            .get(`/api/payroll/reports?month=${month}&year=${year}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        expect(res.body.data.summary.totalEmployees).toBeGreaterThanOrEqual(1);
        expect(res.body.data.records.some(r => r.user._id === john._id.toString())).toBe(true);
    });

    test('GET /api/payroll/reports/export streams an xlsx file', async () => {
        const res = await request(app)
            .get(`/api/payroll/reports/export?month=${month}&year=${year}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .buffer(true)
            .parse((response, callback) => {
                response.setEncoding('binary');
                let data = '';
                response.on('data', chunk => { data += chunk; });
                response.on('end', () => callback(null, Buffer.from(data, 'binary')));
            });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(res.body.length).toBeGreaterThan(0);
    });

    test('GET /api/payroll/settings returns defaults, PUT updates them', async () => {
        const before = await request(app)
            .get('/api/payroll/settings')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(before.status).toBe(200);
        expect(before.body.data.payrollCycleDay).toBe(1);
        expect(before.body.data.latePolicy).toEqual([
            { lateCount: 3, deductionDays: 0.5 },
            { lateCount: 6, deductionDays: 1 }
        ]);

        const updated = await request(app)
            .put('/api/payroll/settings')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ payrollCycleDay: 5, latePolicy: [{ lateCount: 2, deductionDays: 1 }] });

        expect(updated.status).toBe(200);
        expect(updated.body.data.payrollCycleDay).toBe(5);
        expect(updated.body.data.latePolicy).toEqual([{ lateCount: 2, deductionDays: 1 }]);
        // Untouched fields keep their defaults
        expect(updated.body.data.defaultCurrency).toBe('INR');
    });

    test('a non-admin cannot reach any payroll endpoint', async () => {
        const res = await request(app)
            .get('/api/payroll/settings')
            .set('Authorization', `Bearer ${tokenFor(john)}`);
        expect(res.status).toBe(403);
    });
});
