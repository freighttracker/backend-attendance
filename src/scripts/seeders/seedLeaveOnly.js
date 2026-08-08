const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const { LeaveType } = require('../../models');

// Standalone leave-type catalogue seeder. Upserts by `code` (never deletes),
// so it's safe to re-run and never wipes any other data. Independent of
// seed.js/seedAdminOnly.js - do not import this from either.
//
// All leave types are seeded with isPaid:false because paid/unpaid is no
// longer a leave-type default - the admin decides it explicitly for each
// request at approval time (LeaveRequest.paidStatus).
const LEAVE_TYPES = [
    { name: 'Casual Leave', code: 'CL', description: 'Casual leave for personal matters', defaultDaysPerYear: 12, isPaid: false, isUnlimited: false, colorCode: '#3B82F6' },
    { name: 'Paid Leave', code: 'PL', description: 'Standard paid leave', defaultDaysPerYear: 12, isPaid: false, isUnlimited: false, colorCode: '#10B981' },
    { name: 'Sick Leave', code: 'SL', description: 'Medical leave for health issues', defaultDaysPerYear: 10, isPaid: false, isUnlimited: false, colorCode: '#F59E0B' },
    { name: 'Medical Leave', code: 'ML', description: 'Extended medical leave', defaultDaysPerYear: 15, isPaid: false, isUnlimited: false, colorCode: '#EF4444' },
    { name: 'Emergency Leave', code: 'EL', description: 'Urgent/emergency leave', defaultDaysPerYear: 5, isPaid: false, isUnlimited: false, colorCode: '#8B5CF6' },
    { name: 'Leave Without Pay', code: 'LWP', description: 'Unpaid leave, always available regardless of balance', defaultDaysPerYear: 0, isPaid: false, isUnlimited: true, maxDaysAtOnce: 365, colorCode: '#6B7280' }
];

const run = async () => {
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    console.log('\n--- Leave type seed starting ---\n');

    for (const type of LEAVE_TYPES) {
        const result = await LeaveType.findOneAndUpdate(
            { code: type.code },
            { $set: { ...type, requiresApproval: true, isActive: true } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log(`Upserted leave type: ${result.code} - ${result.name}`);
    }

    console.log('\n--- Leave type seed complete ---');
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
