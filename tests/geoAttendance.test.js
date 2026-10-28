const moment = require('moment');
const mongoose = require('mongoose');
const request = require('supertest');
const { connect, closeDatabase } = require('./helpers/db');
const { tokenFor } = require('./helpers/auth');
const {
    User,
    Company,
    WeekendConfig,
    AttendanceRecord,
    AttendanceGeoPolicy,
    OfficeLocation,
    EmployeeOfficeAssignment,
    AuditLog
} = require('../src/models');
const { distanceMeters, parseCoordinates, purgeExpiredLocationData } = require('../src/services/geoAttendance.service');

// All GPS readings below are mocked coordinates - nothing depends on a real
// device. HQ sits in Ahmedabad; 0.0003 deg of latitude is ~33 m.
const HQ = { latitude: 23.0225, longitude: 72.5714 };
const BRANCH = { latitude: 23.05, longitude: 72.53 };
const near = (point, dLat = 0.0003) => ({ latitude: point.latitude + dLat, longitude: point.longitude });
const FAR = { latitude: 23.0325, longitude: 72.5714 }; // ~1.1 km north of HQ

let app;
let companyA;
let companyB;
let superadmin;
let adminA;
let adminB;
let subAdminA;
let userSeq = 0;

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

const makeUser = (overrides = {}) => {
    userSeq += 1;
    return User.create({
        employeeCode: `GEO${String(userSeq).padStart(3, '0')}`,
        email: `geo${userSeq}@example.com`,
        password: 'password123',
        firstName: 'Geo',
        lastName: `User${userSeq}`,
        role: 'employee',
        department: 'Operations',
        isActive: true,
        ...overrides
    });
};

const makeOffice = (overrides = {}) => OfficeLocation.create({
    name: `Office ${Math.random().toString(36).slice(2, 7)}`,
    address: 'Test address',
    ...HQ,
    radiusMeters: 100,
    company: companyA._id,
    isActive: true,
    ...overrides
});

const assign = (user, office, extra = {}) => EmployeeOfficeAssignment.create({
    user: user._id,
    office: office._id,
    company: user.company,
    isPrimary: true,
    isActive: true,
    ...extra
});

const setPolicy = (companyId, values) => AttendanceGeoPolicy.findOneAndUpdate(
    { company: companyId },
    { $set: { company: companyId, ...values } },
    { upsert: true, new: true }
);

const checkIn = (user, body = {}) => request(app).post('/api/attendance/check-in').set(auth(user)).send(body);
const checkOut = (user, body = {}) => request(app).post('/api/attendance/check-out').set(auth(user)).send(body);

beforeAll(async () => {
    await connect();
    app = require('../src/app');

    // Make "today" a working day whatever day the suite runs on.
    await WeekendConfig.insertMany(
        ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
            .map((dayOfWeek) => ({ dayOfWeek, isWeekend: false, isHalfDay: false, halfDayHours: 4 }))
    );

    companyA = await Company.create({ name: 'Company A', code: 'GEOA' });
    companyB = await Company.create({ name: 'Company B', code: 'GEOB' });
    superadmin = await makeUser({ role: 'superadmin' });
    adminA = await makeUser({ role: 'company_admin', company: companyA._id });
    adminB = await makeUser({ role: 'company_admin', company: companyB._id });
    subAdminA = await makeUser({ role: 'subcompany_admin', company: companyA._id });
});

afterAll(async () => {
    await closeDatabase();
});

describe('geo math and coordinate parsing', () => {
    test('distanceMeters matches known distances', () => {
        expect(distanceMeters(HQ.latitude, HQ.longitude, HQ.latitude, HQ.longitude)).toBe(0);
        const d = distanceMeters(HQ.latitude, HQ.longitude, HQ.latitude + 0.001, HQ.longitude);
        expect(d).toBeGreaterThan(110);
        expect(d).toBeLessThan(112.5);
    });

    test('parseCoordinates rejects bad readings and accepts good ones', () => {
        expect(parseCoordinates({})).toEqual({ coords: null, error: null });
        expect(parseCoordinates({ latitude: 95, longitude: 10, accuracy: 5 }).error).toMatch(/Latitude/);
        expect(parseCoordinates({ latitude: 10, longitude: 190, accuracy: 5 }).error).toMatch(/Longitude/);
        expect(parseCoordinates({ latitude: 0, longitude: 0, accuracy: 5 }).error).toMatch(/0,0/);
        expect(parseCoordinates({ latitude: 10, longitude: 10 }).error).toMatch(/accuracy/);
        expect(parseCoordinates({ latitude: 'abc', longitude: 10, accuracy: 5 }).error).toMatch(/Latitude/);
        expect(parseCoordinates({ latitude: '23.1', longitude: 72.5, accuracy: 12.34 }).coords)
            .toEqual({ latitude: 23.1, longitude: 72.5, accuracy: 12.3 });
    });
});

describe('office location management', () => {

    test('company admin creates an office; default radius comes from the policy', async () => {
        await setPolicy(companyA._id, { defaultRadiusMeters: 150 });
        const res = await request(app).post('/api/office-locations').set(auth(adminA))
            .send({ name: 'HQ', address: '1 Main Rd', ...HQ, companyId: String(companyB._id) });

        expect(res.status).toBe(201);
        expect(res.body.data.radiusMeters).toBe(150);
        // A non-superadmin can never file an office under another company.
        expect(String(res.body.data.company)).toBe(String(companyA._id));

        // entityId is Mixed (not cast), so query with the stored ObjectId type.
        const audit = await AuditLog.findOne({ action: 'office_location.create', entityId: new mongoose.Types.ObjectId(res.body.data._id) });
        expect(audit).not.toBeNull();
        expect(String(audit.company)).toBe(String(companyA._id));
    });

    test('backend validates coordinates, radius and required fields', async () => {
        const base = { name: 'X', address: 'Y', ...HQ, radiusMeters: 100 };
        const cases = [
            { ...base, latitude: 95 },
            { ...base, longitude: -181 },
            { ...base, radiusMeters: 5 },
            { ...base, name: '' },
            { ...base, address: undefined },
            { ...base, latitude: 0, longitude: 0 }
        ];
        for (const body of cases) {
            const res = await request(app).post('/api/office-locations').set(auth(adminA)).send(body);
            expect(res.status).toBe(400);
        }
    });

    test('employees and other tenants cannot manage or see an office', async () => {
        const employee = await makeUser({ company: companyA._id });
        const office = await makeOffice();

        expect((await request(app).post('/api/office-locations').set(auth(employee)).send({ name: 'E', address: 'E', ...HQ })).status).toBe(403);
        expect((await request(app).get('/api/office-locations').set(auth(employee))).status).toBe(403);

        expect((await request(app).get(`/api/office-locations/${office._id}`).set(auth(adminB))).status).toBe(403);
        expect((await request(app).put(`/api/office-locations/${office._id}`).set(auth(adminB)).send({ name: 'Hijack' })).status).toBe(403);
        const list = await request(app).get('/api/office-locations').set(auth(adminB));
        expect(list.status).toBe(200);
        expect(list.body.data.find((o) => String(o._id) === String(office._id))).toBeUndefined();
    });

    test('subcompany admin cannot create offices by default but can list them', async () => {
        const create = await request(app).post('/api/office-locations').set(auth(subAdminA)).send({ name: 'S', address: 'S', ...HQ });
        expect(create.status).toBe(403);
        expect((await request(app).get('/api/office-locations').set(auth(subAdminA))).status).toBe(200);
    });

    test('update and deactivate are audited', async () => {
        const office = await makeOffice();
        const upd = await request(app).put(`/api/office-locations/${office._id}`).set(auth(adminA)).send({ radiusMeters: 250 });
        expect(upd.status).toBe(200);
        expect(upd.body.data.radiusMeters).toBe(250);

        const off = await request(app).put(`/api/office-locations/${office._id}/status`).set(auth(adminA)).send({ isActive: false });
        expect(off.status).toBe(200);
        expect(off.body.data.isActive).toBe(false);

        const actions = (await AuditLog.find({ entityId: office._id })).map((a) => a.action).sort();
        expect(actions).toEqual(['office_location.deactivate', 'office_location.update']);
    });
});

describe('employee office assignments', () => {

    test('assigns multiple offices with one primary and is readable by the employee', async () => {

        const employee = await makeUser({ company: companyA._id });
        const o1 = await makeOffice();
        const o2 = await makeOffice({ ...BRANCH });

        const res = await request(app).put(`/api/users/${employee._id}/office-assignments`).set(auth(adminA))
            .send({ assignments: [{ officeId: o1._id }, { officeId: o2._id, isPrimary: true, effectiveFrom: '2020-01-01' }] });
        expect(res.status).toBe(200);
        
        expect(res.body.data.assignments).toHaveLength(2);
        expect(res.body.data.assignments.filter((a) => a.isPrimary)).toHaveLength(1);
        expect(String(res.body.data.assignments.find((a) => a.isPrimary).office._id)).toBe(String(o2._id));

        const own = await request(app).get(`/api/users/${employee._id}/office-assignments`).set(auth(employee));
        expect(own.status).toBe(200);
        expect(own.body.data.assignments).toHaveLength(2);

        // Removing one keeps it as inactive history rather than deleting it.
        const shrink = await request(app).put(`/api/users/${employee._id}/office-assignments`).set(auth(adminA))
            .send({ assignments: [{ officeId: o1._id }] });
        expect(shrink.status).toBe(200);
        expect(shrink.body.data.assignments).toHaveLength(1);
        expect(shrink.body.data.assignments[0].isPrimary).toBe(true);
        expect(await EmployeeOfficeAssignment.countDocuments({ user: employee._id, isActive: false })).toBe(1);
        expect(await AuditLog.countDocuments({ action: 'office_assignment.set', entityId: employee._id })).toBe(2);
    });

    test('rejects invalid assignments', async () => {
        const employee = await makeUser({ company: companyA._id });
        const office = await makeOffice();
        const inactive = await makeOffice({ isActive: false });
        const foreign = await makeOffice({ company: companyB._id });
        const put = (user, assignments) => request(app).put(`/api/users/${employee._id}/office-assignments`).set(auth(user)).send({ assignments });

        expect((await put(adminA, [{ officeId: inactive._id }])).status).toBe(400);
        expect((await put(adminA, [{ officeId: foreign._id }])).status).toBe(403);
        expect((await put(adminA, [{ officeId: office._id, isPrimary: true }, { officeId: (await makeOffice())._id, isPrimary: true }])).status).toBe(400);
        expect((await put(adminA, [{ officeId: office._id, effectiveFrom: '2026-05-10', effectiveTo: '2026-05-01' }])).status).toBe(400);
        expect((await put(adminA, [{ officeId: office._id }, { officeId: office._id }])).status).toBe(400);
        expect((await put(employee, [{ officeId: office._id }])).status).toBe(403);
        expect((await put(adminB, [{ officeId: office._id }])).status).toBe(403);
    });
});

describe('geofenced check-in / check-out (enforce mode)', () => {
    let office;
    let branch;

    beforeAll(async () => {
        const res = await request(app).put('/api/attendance/geo-policy').set(auth(adminA))
            .send({ checkInMode: 'enforce', checkOutMode: 'enforce', maxAccuracyMeters: 50, allowExceptions: true });
        expect(res.status).toBe(200);
        office = await makeOffice({ name: 'Enforced HQ' });
        branch = await makeOffice({ name: 'Enforced Branch', ...BRANCH });
    });

    test('employees cannot change the policy', async () => {
        const employee = await makeUser({ company: companyA._id });
        expect((await request(app).put('/api/attendance/geo-policy').set(auth(employee)).send({ checkInMode: 'off' })).status).toBe(403);
        expect((await request(app).put('/api/attendance/geo-policy').set(auth(adminA)).send({ checkInMode: 'sometimes' })).status).toBe(400);
    });

    test('today endpoint tells the dashboard location is required', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);
        const res = await request(app).get('/api/attendance/today').set(auth(employee));
        expect(res.status).toBe(200);
        expect(res.body.data.geo.checkInMode).toBe('enforce');
        expect(res.body.data.geo.offices.map((o) => o.name)).toEqual(['Enforced HQ']);
    });

    test('missing location, invalid coordinates and poor accuracy are rejected', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);

        const none = await checkIn(employee);
        expect(none.status).toBe(400);
        expect(none.body.code).toBe('LOCATION_REQUIRED');

        const bad = await checkIn(employee, { latitude: 123, longitude: 72, accuracy: 5 });
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe('INVALID_COORDINATES');

        const fuzzy = await checkIn(employee, { ...near(HQ), accuracy: 500 });
        expect(fuzzy.status).toBe(422);
        expect(fuzzy.body.code).toBe('LOW_ACCURACY');

        expect(await AttendanceRecord.countDocuments({ user: employee._id })).toBe(0);
    });

    test('outside the geofence is rejected with an exception option', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);

        const res = await checkIn(employee, { ...FAR, accuracy: 10 });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('OUTSIDE_GEOFENCE');
        expect(res.body.details.canRequestException).toBe(true);
        expect(res.body.details.distanceMeters).toBeGreaterThan(1000);
    });

    test('valid check-in stores server-computed office, distance and status; client office id is ignored', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);

        const res = await checkIn(employee, { ...near(HQ), accuracy: 12, officeId: String(branch._id), validationStatus: 'valid' });
        expect(res.status).toBe(200);

        const record = await AttendanceRecord.findOne({ user: employee._id });
        expect(String(record.checkIn.office)).toBe(String(office._id));
        expect(record.checkIn.validationStatus).toBe('valid');
        expect(record.checkIn.reviewStatus).toBe('none');
        expect(record.checkIn.distanceMeters).toBeGreaterThan(25);
        expect(record.checkIn.distanceMeters).toBeLessThan(45);
        expect(record.checkIn.accuracy).toBe(12);
        expect(String(record.company)).toBe(String(companyA._id));

        const dup = await checkIn(employee, { ...near(HQ), accuracy: 12 });
        expect(dup.status).toBe(409);
        expect(dup.body.code).toBe('ALREADY_CHECKED_IN');
    });

    test('multiple assigned offices: the office actually reached is recorded', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);
        await assign(employee, branch, { isPrimary: false });

        const res = await checkIn(employee, { ...near(BRANCH, 0.0002), accuracy: 8 });
        expect(res.status).toBe(200);
        const record = await AttendanceRecord.findOne({ user: employee._id });
        expect(record.checkIn.officeName).toBe('Enforced Branch');
    });

    test('no assignment, inactive office or future assignment cannot check in', async () => {
        const unassigned = await makeUser({ company: companyA._id });
        const r1 = await checkIn(unassigned, { ...near(HQ), accuracy: 10 });
        expect(r1.status).toBe(403);
        expect(r1.body.code).toBe('NO_ACTIVE_OFFICE');

        const closed = await makeOffice({ isActive: false });
        const atClosed = await makeUser({ company: companyA._id });
        await assign(atClosed, closed);
        expect((await checkIn(atClosed, { ...near(HQ), accuracy: 10 })).body.code).toBe('NO_ACTIVE_OFFICE');

        const future = await makeUser({ company: companyA._id });
        await assign(future, office, { effectiveFrom: moment().add(5, 'days').toDate() });
        expect((await checkIn(future, { ...near(HQ), accuracy: 10 })).body.code).toBe('NO_ACTIVE_OFFICE');

        const expired = await makeUser({ company: companyA._id });
        await assign(expired, office, { effectiveTo: moment().subtract(1, 'day').toDate() });
        expect((await checkIn(expired, { ...near(HQ), accuracy: 10 })).body.code).toBe('NO_ACTIVE_OFFICE');
    });

    test('an office closed to check-in still accepts check-out', async () => {
        const site = await makeOffice({ name: 'Checkout-only site', ...BRANCH, allowCheckIn: false });
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);
        await assign(employee, site, { isPrimary: false });

        expect((await checkIn(employee, { ...near(BRANCH), accuracy: 10 })).status).toBe(403);
        expect((await checkIn(employee, { ...near(HQ), accuracy: 10 })).status).toBe(200);
        const out = await checkOut(employee, { ...near(BRANCH), accuracy: 10 });
        expect(out.status).toBe(200);
        const record = await AttendanceRecord.findOne({ user: employee._id });
        expect(record.checkOut.officeName).toBe('Checkout-only site');
    });

    test('check-out workflow: requires a session, validates location, blocks duplicates', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);

        const early = await checkOut(employee, { ...near(HQ), accuracy: 10 });
        expect(early.status).toBe(400);
        expect(early.body.code).toBe('NOT_CHECKED_IN');

        expect((await checkIn(employee, { ...near(HQ), accuracy: 10 })).status).toBe(200);
        const outside = await checkOut(employee, { ...FAR, accuracy: 10 });
        expect(outside.status).toBe(403);
        expect((await AttendanceRecord.findOne({ user: employee._id })).checkOut.time).toBeFalsy();

        const ok = await checkOut(employee, { ...near(HQ), accuracy: 10 });
        expect(ok.status).toBe(200);
        const record = await AttendanceRecord.findOne({ user: employee._id });
        expect(record.checkOut.validationStatus).toBe('valid');
        expect(record.checkIn.validationStatus).toBe('valid');

        const dup = await checkOut(employee, { ...near(HQ), accuracy: 10 });
        expect(dup.status).toBe(409);
        expect(dup.body.code).toBe('ALREADY_CHECKED_OUT');
    });

    test('concurrent duplicate check-ins and check-outs: exactly one succeeds', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);
        const body = { ...near(HQ), accuracy: 10 };

        const ins = await Promise.all([checkIn(employee, body), checkIn(employee, body), checkIn(employee, body)]);
        expect(ins.map((r) => r.status).sort()).toEqual([200, 409, 409]);
        expect(await AttendanceRecord.countDocuments({ user: employee._id })).toBe(1);

        const outs = await Promise.all([checkOut(employee, body), checkOut(employee, body), checkOut(employee, body)]);
        expect(outs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    });

    test('exception with a reason is recorded as pending and reviewed once by an admin', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);

        expect((await checkIn(employee, { ...FAR, accuracy: 10, exceptionReason: 'no' })).body.code).toBe('INVALID_EXCEPTION_REASON');

        const res = await checkIn(employee, { ...FAR, accuracy: 10, exceptionReason: 'Client visit before office' });
        expect(res.status).toBe(200);
        const record = await AttendanceRecord.findOne({ user: employee._id });
        expect(record.checkIn.validationStatus).toBe('outside_geofence');
        expect(record.checkIn.reviewStatus).toBe('pending');

        const review = (user, body) => request(app).put(`/api/attendance/${record._id}/location-review`).set(auth(user)).send(body);
        expect((await review(employee, { punch: 'checkIn', decision: 'approved' })).status).toBe(403);
        expect((await review(adminB, { punch: 'checkIn', decision: 'approved' })).status).toBe(403);
        expect((await review(adminA, { punch: 'checkIn', decision: 'rejected' })).status).toBe(400); // remarks required

        const ok = await review(adminA, { punch: 'checkIn', decision: 'approved', remarks: 'Confirmed with manager' });
        expect(ok.status).toBe(200);
        expect((await review(adminA, { punch: 'checkIn', decision: 'approved' })).status).toBe(409);

        const reviewed = await AttendanceRecord.findById(record._id);
        expect(reviewed.checkIn.reviewStatus).toBe('approved');
        expect(String(reviewed.checkIn.reviewedBy)).toBe(String(adminA._id));
        expect(await AuditLog.countDocuments({ action: 'attendance_location.approve', entityId: record._id })).toBe(1);
    });

    test('location permission denied can still go through the exception process', async () => {
        const employee = await makeUser({ company: companyA._id });
        await assign(employee, office);
        const res = await checkIn(employee, { exceptionReason: 'Phone GPS is broken today' });
        expect(res.status).toBe(200);
        const record = await AttendanceRecord.findOne({ user: employee._id });
        expect(record.checkIn.validationStatus).toBe('no_location');
        expect(record.checkIn.reviewStatus).toBe('pending');
    });
});

describe('flag mode and backward compatibility', () => {
    test('flag mode records an out-of-geofence check-in but flags it', async () => {
        const companyF = await Company.create({ name: 'Flag Co', code: 'GEOF' });
        await setPolicy(companyF._id, { checkInMode: 'flag', checkOutMode: 'off' });
        const office = await makeOffice({ company: companyF._id });
        const employee = await makeUser({ company: companyF._id });
        await assign(employee, office);

        const res = await checkIn(employee, { ...FAR, accuracy: 10 });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/flagged for admin review/);
        const record = await AttendanceRecord.findOne({ user: employee._id });
        expect(record.checkIn.validationStatus).toBe('outside_geofence');
        expect(record.checkIn.reviewStatus).toBe('pending');
    });

    test('with no policy, check-in works exactly as before (no location needed)', async () => {
        const legacy = await makeUser({ company: companyB._id });
        const res = await checkIn(legacy);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Checked in successfully');
        const record = await AttendanceRecord.findOne({ user: legacy._id });
        expect(record.checkIn.validationStatus).toBe('not_required');
        expect(record.checkIn.latitude).toBeUndefined();

        const out = await checkOut(legacy);
        expect(out.status).toBe(200);
    });
});

describe('location monitoring and access control', () => {
    let recordA;
    let employeeA;
    let otherEmployeeA;

    beforeAll(async () => {
        const office = await makeOffice({ name: 'Monitored HQ' });
        employeeA = await makeUser({ company: companyA._id, department: 'Finance' });
        otherEmployeeA = await makeUser({ company: companyA._id });
        await assign(employeeA, office);
        expect((await checkIn(employeeA, { ...near(HQ), accuracy: 9 })).status).toBe(200);
        recordA = await AttendanceRecord.findOne({ user: employeeA._id });
    });

    test('company admin sees own-company locations with filters; other tenants do not', async () => {
        const res = await request(app).get('/api/attendance/locations').set(auth(adminA)).query({ department: 'Finance' });
        expect(res.status).toBe(200);
        const row = res.body.data.find((r) => String(r._id) === String(recordA._id));
        expect(row).toBeDefined();
        expect(row.checkIn.office.name).toBe('Monitored HQ');
        expect(row.checkIn.latitude).toBeCloseTo(near(HQ).latitude, 5);
        expect(row.primaryOffice.name).toBe('Monitored HQ');
        expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);

        const valid = await request(app).get('/api/attendance/locations').set(auth(adminA)).query({ validationStatus: 'outside_geofence' });
        expect(valid.body.data.find((r) => String(r._id) === String(recordA._id))).toBeUndefined();

        const b = await request(app).get('/api/attendance/locations').set(auth(adminB));
        expect(b.status).toBe(200);
        expect(b.body.data.find((r) => String(r._id) === String(recordA._id))).toBeUndefined();

        expect((await request(app).get('/api/attendance/locations').set(auth(employeeA))).status).toBe(403);
    });

    test('single-record location: owner and in-scope admin only', async () => {
        expect((await request(app).get(`/api/attendance/${recordA._id}/location`).set(auth(employeeA))).status).toBe(200);
        expect((await request(app).get(`/api/attendance/${recordA._id}/location`).set(auth(adminA))).status).toBe(200);
        expect((await request(app).get(`/api/attendance/${recordA._id}/location`).set(auth(otherEmployeeA))).status).toBe(403);
        expect((await request(app).get(`/api/attendance/${recordA._id}/location`).set(auth(adminB))).status).toBe(403);
        expect((await request(app).get('/api/attendance/not-an-id/location').set(auth(adminA))).status).toBe(400);
    });

    test('office-level permissions narrow an admin to their offices and flags', async () => {
        const restricted = await makeUser({ role: 'subcompany_admin', company: companyA._id });
        const ownOffice = await makeOffice({ name: 'Restricted Office' });

        // A company admin may only configure subcompany admins, never themself.
        expect((await request(app).put(`/api/office-locations/admin-permissions/${adminA._id}`).set(auth(adminA)).send({})).status).toBe(403);
        expect((await request(app).put(`/api/office-locations/admin-permissions/${restricted._id}`).set(auth(restricted)).send({})).status).toBe(403);

        const grant = await request(app).put(`/api/office-locations/admin-permissions/${restricted._id}`).set(auth(adminA))
            .send({ offices: [String(ownOffice._id)], canViewLocations: true, canManageAssignments: true });
        expect(grant.status).toBe(200);

        const list = await request(app).get('/api/office-locations').set(auth(restricted));
        expect(list.body.data.map((o) => o.name)).toEqual(['Restricted Office']);

        // employeeA is not at the restricted admin's office.
        const locs = await request(app).get('/api/attendance/locations').set(auth(restricted));
        expect(locs.status).toBe(200);
        expect(locs.body.data.find((r) => String(r._id) === String(recordA._id))).toBeUndefined();
        expect((await request(app).get(`/api/attendance/${recordA._id}/location`).set(auth(restricted))).status).toBe(403);
        // Review was not granted.
        expect((await request(app).put(`/api/attendance/${recordA._id}/location-review`).set(auth(restricted))
            .send({ punch: 'checkIn', decision: 'approved' })).status).toBe(403);

        const revoke = await request(app).put(`/api/office-locations/admin-permissions/${restricted._id}`).set(auth(superadmin))
            .send({ canViewLocations: false });
        expect(revoke.status).toBe(200);
        expect((await request(app).get('/api/attendance/locations').set(auth(restricted))).status).toBe(403);

        const reset = await request(app).delete(`/api/office-locations/admin-permissions/${restricted._id}`).set(auth(adminA));
        expect(reset.status).toBe(200);
        expect(reset.body.data.isCustom).toBe(false);
        expect((await request(app).get('/api/attendance/locations').set(auth(restricted))).status).toBe(200);
    });

    test('geo audit log is tenant-scoped', async () => {
        const a = await request(app).get('/api/attendance/geo-audit-logs').set(auth(adminA));
        expect(a.status).toBe(200);
        expect(a.body.data.length).toBeGreaterThan(0);
        expect(a.body.data.every((log) => String(log.company) === String(companyA._id))).toBe(true);

        const b = await request(app).get('/api/attendance/geo-audit-logs').set(auth(adminB));
        expect(b.body.data.every((log) => String(log.company) === String(companyB._id))).toBe(true);

        expect((await request(app).get('/api/attendance/geo-audit-logs').set(auth(subAdminA))).status).toBe(403);
    });
});

describe('location data retention', () => {
    test('purge strips coordinates past retention but keeps the attendance', async () => {
        const companyR = await Company.create({ name: 'Retention Co', code: 'GEOR' });
        await setPolicy(companyR._id, { locationRetentionDays: 30 });
        const employee = await makeUser({ company: companyR._id });
        const old = await AttendanceRecord.create({
            user: employee._id,
            company: companyR._id,
            date: moment().subtract(60, 'days').startOf('day').toDate(),
            status: 'present',
            checkIn: { time: moment().subtract(60, 'days').toDate(), ...near(HQ), accuracy: 10, validationStatus: 'valid' }
        });
        const recent = await AttendanceRecord.create({
            user: employee._id,
            company: companyR._id,
            date: moment().subtract(5, 'days').startOf('day').toDate(),
            status: 'present',
            checkIn: { time: moment().subtract(5, 'days').toDate(), ...near(HQ), accuracy: 10, validationStatus: 'valid' }
        });

        await purgeExpiredLocationData();

        const oldAfter = await AttendanceRecord.findById(old._id);
        expect(oldAfter.checkIn.latitude).toBeUndefined();
        expect(oldAfter.checkIn.locationPurgedAt).toBeTruthy();
        expect(oldAfter.checkIn.validationStatus).toBe('valid');
        expect(oldAfter.status).toBe('present');
        expect((await AttendanceRecord.findById(recent._id)).checkIn.latitude).toBeCloseTo(near(HQ).latitude, 5);
    });
});
