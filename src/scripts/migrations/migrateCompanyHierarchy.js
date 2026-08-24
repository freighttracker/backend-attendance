const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const { User, Company, SubCompany, AttendanceRecord } = require('../../models');

// One-time backfill for the new Company -> SubCompany -> User hierarchy.
// Every existing user/attendance record currently has no company at all
// (they predate the concept), which the app treats as "unscoped" and every
// superadmin/admin account already sees regardless - so this is NOT required
// for the app to keep working. It exists so that from day one there is at
// least one real Company/SubCompany to assign new company-scoped admins and
// employees to, and so existing employees show up under it instead of
// floating with no company forever.
//
// Idempotent: safe to run more than once. Never deletes or overwrites data -
// only ever fills in `company`/`subCompany` on documents where those fields
// are currently null, and only ever creates the default Company/SubCompany
// if they don't already exist (matched by code).
const DEFAULT_COMPANY_CODE = 'DEFAULT';
const DEFAULT_SUBCOMPANY_CODE = 'MAIN';

const run = async () => {
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    let company = await Company.findOne({ code: DEFAULT_COMPANY_CODE });
    if (!company) {
        company = await Company.create({
            name: 'Default Company',
            code: DEFAULT_COMPANY_CODE,
            country: 'India',
            isActive: true
        });
        console.log(`Created default company: ${company.name} (${company.code})`);
    } else {
        console.log(`Default company already exists: ${company.name} (${company.code})`);
    }

    let subCompany = await SubCompany.findOne({ company: company._id, code: DEFAULT_SUBCOMPANY_CODE });
    if (!subCompany) {
        subCompany = await SubCompany.create({
            company: company._id,
            name: 'Main Branch',
            code: DEFAULT_SUBCOMPANY_CODE,
            country: 'India',
            isActive: true
        });
        console.log(`Created default subcompany: ${subCompany.name} (${subCompany.code})`);
    } else {
        console.log(`Default subcompany already exists: ${subCompany.name} (${subCompany.code})`);
    }

    // Backfill only users that have no company yet. superadmin/admin
    // accounts are intentionally left unscoped (null) - they see everything
    // regardless, and assigning them a company would be misleading.
    const userResult = await User.updateMany(
        { company: null, role: { $nin: ['superadmin', 'admin'] } },
        { $set: { company: company._id, subCompany: subCompany._id } }
    );
    console.log(`Backfilled ${userResult.modifiedCount} user(s) into ${company.code}/${subCompany.code}`);

    const attendanceResult = await AttendanceRecord.updateMany(
        { company: null },
        { $set: { company: company._id, subCompany: subCompany._id } }
    );
    console.log(`Backfilled ${attendanceResult.modifiedCount} attendance record(s) into ${company.code}/${subCompany.code}`);

    console.log('Company hierarchy migration complete.');
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
