const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const { LeaveRequest } = require('../../models');

// One-time backfill: pre-existing approved LeaveRequest docs (created before
// paidStatus existed) all default to paidStatus:'unpaid', which would
// silently flip historical paid leave into a loss-of-pay deduction once
// payroll.service.js switches to trusting paidStatus instead of
// leaveType.isPaid. Run this ONCE against the real database before
// deploying that change, to preserve the paid/unpaid classification those
// requests had under the old model. Not part of the automated test suite.
const run = async () => {
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }

    const approved = await LeaveRequest.find({ status: 'approved' }).populate('leaveType', 'isPaid');

    let paidCount = 0;
    let unpaidCount = 0;

    for (const leaveRequest of approved) {
        const wasPaid = leaveRequest.leaveType ? leaveRequest.leaveType.isPaid : false;
        leaveRequest.paidStatus = wasPaid ? 'paid' : 'unpaid';
        await leaveRequest.save();
        wasPaid ? paidCount++ : unpaidCount++;
    }

    console.log(`Backfilled ${paidCount} paid + ${unpaidCount} unpaid approved leave requests (${approved.length} total)`);
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
