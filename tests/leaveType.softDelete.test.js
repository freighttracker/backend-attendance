const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const seedData = require('../src/scripts/seed');
const { LeaveType } = require('../src/models');

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

describe('Leave type soft delete', () => {
    let targetTypeId;

    beforeAll(async () => {
        const type = await LeaveType.findOne({ code: 'WFH' });
        targetTypeId = type._id.toString();
    });

    test('non-admin cannot delete a leave type', async () => {
        const res = await request(app)
            .delete(`/api/leaves/types/${targetTypeId}`)
            .set('Authorization', `Bearer ${tokenFor(john)}`);
        expect(res.status).toBe(403);
    });

    test('DELETE sets isActive:false rather than removing the document', async () => {
        const res = await request(app)
            .delete(`/api/leaves/types/${targetTypeId}`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        expect(res.body.data.isActive).toBe(false);

        const stillExists = await LeaveType.findById(targetTypeId);
        expect(stillExists).not.toBeNull();
        expect(stillExists.isActive).toBe(false);
    });

    test('default GET /types excludes the deactivated type', async () => {
        const res = await request(app)
            .get('/api/leaves/types')
            .set('Authorization', `Bearer ${tokenFor(john)}`);

        expect(res.status).toBe(200);
        expect(res.body.data.some((t) => t._id === targetTypeId)).toBe(false);
    });

    test('admin with ?includeInactive=true sees the deactivated type', async () => {
        const res = await request(app)
            .get('/api/leaves/types?includeInactive=true')
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        expect(res.body.data.some((t) => t._id === targetTypeId)).toBe(true);
    });

    test('a non-admin passing ?includeInactive=true is still filtered to active-only', async () => {
        const res = await request(app)
            .get('/api/leaves/types?includeInactive=true')
            .set('Authorization', `Bearer ${tokenFor(john)}`);

        expect(res.status).toBe(200);
        expect(res.body.data.some((t) => t._id === targetTypeId)).toBe(false);
    });
});
