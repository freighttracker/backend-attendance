const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = require('../../config/database');
const { purgeExpiredLocationData } = require('../../services/geoAttendance.service');

// Removes GPS coordinates (latitude/longitude/accuracy) from attendance
// punches older than each company's locationRetentionDays. The attendance
// record, its times, office and validation result are kept. Schedule this
// daily (e.g. Cloud Scheduler / cron): `npm run geo:purge-locations`.
const run = async () => {
    if (mongoose.connection.readyState === 0) {
        await connectDB();
    }
    const purged = await purgeExpiredLocationData();
    console.log(`Purged coordinates from ${purged} attendance punch(es)`);
};

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Purge error:', error);
            process.exit(1);
        });
}

module.exports = run;
