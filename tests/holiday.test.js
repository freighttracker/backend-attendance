const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');

let app;
let admin;
let employee;

beforeAll(async () => {
    await connect();
    app = require('../src/app');
    const seeded = await seedData();
    admin = seeded.admin;
    employee = seeded.employees[0];
});

afterAll(async () => {
    await closeDatabase();
});

describe('Holiday API', () => {
    test('rejects unauthenticated requests', async () => {
        const res = await request(app).get('/api/holidays');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    test('any authenticated user can list seeded holidays', async () => {
        const res = await request(app)
            .get('/api/holidays')
            .set('Authorization', `Bearer ${tokenFor(employee)}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBe(3);
        expect(res.body.data.map(h => h.name)).toEqual(
            expect.arrayContaining(['Founders Day', 'National Holiday', 'Festival Holiday'])
        );
    });

    test('a non-admin employee cannot create a holiday', async () => {
        const res = await request(app)
            .post('/api/holidays')
            .set('Authorization', `Bearer ${tokenFor(employee)}`)
            .send({ name: 'Unauthorized Holiday', date: '2026-12-25', type: 'company' });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    test('an admin can create a new holiday', async () => {
        const res = await request(app)
            .post('/api/holidays')
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ name: 'Christmas', date: '2026-12-25', type: 'national', description: 'Christmas Day' });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe('Christmas');

        const listRes = await request(app)
            .get('/api/holidays')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        expect(listRes.body.data.length).toBe(4);
    });
});
