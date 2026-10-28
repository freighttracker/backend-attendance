const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const {
    OfficeLocation,
    EmployeeOfficeAssignment,
    AttendanceGeoPolicy,
    OfficeAdminPermission,
    AttendanceRecord,
    AuditLog
} = require('../../models');

// Non-destructive setup for GPS/geofenced attendance:
//   - creates the new collections' indexes (office_locations,
//     employee_office_assignments, attendance_geo_policies,
//     office_admin_permissions) and the new AttendanceRecord/AuditLog indexes;
//   - creates the platform-default policy with both modes 'off', so nothing
//     changes for anyone until an admin turns geofencing on.
// Existing attendance records are not modified - the new checkIn/checkOut
// location fields are optional and simply absent on old records.
// Safe to run more than once.
const run = async () => {
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    // createIndexes only adds missing indexes; it never drops existing ones.
    for (const model of [OfficeLocation, EmployeeOfficeAssignment, AttendanceGeoPolicy, OfficeAdminPermission, AttendanceRecord, AuditLog]) {
        await model.createCollection().catch((err) => {
            if (err.codeName !== 'NamespaceExists') throw err;
        });
        await model.createIndexes();
        console.log(`Indexes ensured for ${model.collection.collectionName}`);
    }

    const result = await AttendanceGeoPolicy.updateOne(
        { company: null },
        { $setOnInsert: { company: null, checkInMode: 'off', checkOutMode: 'off', defaultRadiusMeters: 100, maxAccuracyMeters: 100, allowExceptions: true, locationRetentionDays: 365 } },
        { upsert: true }
    );
    console.log(result.upsertedCount ? 'Platform-default geofencing policy created (modes: off)' : 'Platform-default geofencing policy already exists - left unchanged');
};

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Migration error:', error);
            process.exit(1);
        });
}

module.exports = run;
