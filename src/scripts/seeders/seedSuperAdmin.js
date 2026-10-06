const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const { User } = require('../../models');

// Seeds (or promotes) exactly ONE account with Super Admin power - full,
// unrestricted access to everything, unscoped to any single company (see
// middleware/scope.middleware.js's SUPERADMIN_ROLES).
//
// Unlike seedAdminOnly.js, this NEVER wipes existing data - safe to run
// against a live database with real users already in it:
//   - If a user with SUPERADMIN_EMAIL already exists, it's promoted to
//     role 'superadmin' in place. Its password is never touched.
//   - Otherwise a brand new superadmin account is created with
//     SUPERADMIN_PASSWORD (or a generated o
// ne, printed once below - change
//     it after first login).
//   - Idempotent: running it again when the account is already a
//     superadmin just confirms that and exits.

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'yashtrandinginc@gmail.com';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
const SUPERADMIN_FIRST_NAME = process.env.SUPERADMIN_FIRST_NAME || 'Super';
const SUPERADMIN_LAST_NAME = process.env.SUPERADMIN_LAST_NAME || 'Admin';

const generatePassword = () => `Sup3r${Math.random().toString(36).slice(2, 10)}!`;

const run = async () => {

    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    let user = await User.findOne({ email: SUPERADMIN_EMAIL });

    if (user) {

        if (user.role === 'superadmin') {
            console.log(`${user.email} is already a superadmin - nothing to do.`);
            return { user, created: false, passwordShown: null };
        }

        const previousRole = user.role;
        user.role = 'superadmin';

        // A superadmin is unscoped - it must not be pinned to any one
        // company, or scope.middleware.js's isSuperAdmin check would still
        // treat it as unrestricted (role check comes first), but leaving a
        // stale company/subCompany here would be misleading in the UI.
        
        user.company = null;
        user.subCompany = null;
        await user.save();
        console.log(`Promoted ${user.email} from '${previousRole}' to 'superadmin'. Password unchanged.`);
        return { user, created: false, passwordShown: null };
    }

    const passwordToUse = SUPERADMIN_PASSWORD || generatePassword();
    const employeeCode = `SA${Date.now().toString().slice(-6)}`;

    user = await User.create({
        employeeCode,
        email: SUPERADMIN_EMAIL,
        password: passwordToUse,
        firstName: SUPERADMIN_FIRST_NAME,
        lastName: SUPERADMIN_LAST_NAME,
        role: 'superadmin',
        isActive: true,
        isVerified: true,
        company: null,
        subCompany: null
    });

    console.log(`Created new superadmin: ${user.email}`);
    if (!SUPERADMIN_PASSWORD) {
        console.log(`Generated password: ${passwordToUse}`);
        console.log('No SUPERADMIN_PASSWORD was set, so this was auto-generated - change it after first login.');
    }

    return { user, created: true, passwordShown: !SUPERADMIN_PASSWORD ? passwordToUse : null };
};

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Seed error:', error);
            process.exit(1);
        });
}

module.exports = run;
