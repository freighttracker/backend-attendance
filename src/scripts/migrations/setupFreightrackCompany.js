const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const { User, Company, SubCompany, AttendanceRecord, SalaryStructure, SalarySlip } = require('../../models');

// The concrete, real-world setup for this deployment (as opposed to
// migrateCompanyHierarchy.js's generic "Default Company" placeholder):
//
//   1. Promote the existing admin account (yashtrandinginc@gmail.com   , seeded by
//      seedAdminOnly.js) to role 'superadmin'. Its login/password are
//      untouched - only the role field changes.
//   2. Create a real "Freightrack" Company + a "Head Office" SubCompany
//      under it.
//   3. Move every OTHER existing user (and their attendance/salary
//      structure/salary slip records) into Freightrack / Head Office.
//
// Idempotent - safe to run more than once. Never deletes data, never
// touches the superadmin's password, only ever fills in company/subCompany
// on documents that don't already have one.
const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'yashtrandinginc@gmail.com';
const COMPANY_NAME = 'Freightrack';
const COMPANY_CODE = 'FREIGHTRACK';
const SUBCOMPANY_NAME = 'Head Office';
const SUBCOMPANY_CODE = 'HO';

const run = async () => {
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    const superAdmin = await User.findOne({ email: SUPERADMIN_EMAIL });
    if (!superAdmin) {
        throw new Error(`No user found with email ${SUPERADMIN_EMAIL} - set SUPERADMIN_EMAIL to the correct admin account and re-run.`);
    }
    if (superAdmin.role !== 'superadmin') {
        superAdmin.role = 'superadmin';
        superAdmin.company = null;
        superAdmin.subCompany = null;
        await superAdmin.save();
        console.log(`Promoted ${superAdmin.email} to role 'superadmin' (unrestricted access, unscoped to any one company)`);
    } else {
        console.log(`${superAdmin.email} is already a superadmin`);
    }

    let company = await Company.findOne({ code: COMPANY_CODE });
    if (!company) {
        company = await Company.create({
            name: COMPANY_NAME,
            code: COMPANY_CODE,
            country: 'India',
            isActive: true,
            createdBy: superAdmin._id,
            updatedBy: superAdmin._id
        });
        console.log(`Created company: ${company.name} (${company.code})`);
    } else {
        console.log(`Company already exists: ${company.name} (${company.code})`);
    }

    let subCompany = await SubCompany.findOne({ company: company._id, code: SUBCOMPANY_CODE });
    if (!subCompany) {
        subCompany = await SubCompany.create({
            company: company._id,
            name: SUBCOMPANY_NAME,
            code: SUBCOMPANY_CODE,
            country: 'India',
            isActive: true,
            createdBy: superAdmin._id,
            updatedBy: superAdmin._id
        });
        console.log(`Created subcompany: ${subCompany.name} (${subCompany.code}) under ${company.code}`);
    } else {
        console.log(`Subcompany already exists: ${subCompany.name} (${subCompany.code})`);
    }

    const userResult = await User.updateMany(
        { _id: { $ne: superAdmin._id }, company: null },
        { $set: { company: company._id, subCompany: subCompany._id } }
    );
    console.log(`Assigned ${userResult.modifiedCount} employee(s) to ${company.code}/${subCompany.code}`);

    const attendanceResult = await AttendanceRecord.updateMany(
        { company: null },
        { $set: { company: company._id, subCompany: subCompany._id } }
    );
    console.log(`Backfilled ${attendanceResult.modifiedCount} attendance record(s)`);

    const structureResult = await SalaryStructure.updateMany(
        { company: null },
        { $set: { company: company._id, subCompany: subCompany._id } }
    );
    console.log(`Backfilled ${structureResult.modifiedCount} salary structure(s)`);

    const slipResult = await SalarySlip.updateMany(
        { company: null },
        { $set: { company: company._id, subCompany: subCompany._id } }
    );
    console.log(`Backfilled ${slipResult.modifiedCount} salary slip(s)`);

    console.log('\nFreightrack setup complete.');
    console.log(`Superadmin login: ${superAdmin.email} (existing password unchanged)`);
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
