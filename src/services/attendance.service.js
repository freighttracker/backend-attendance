const moment = require('moment-timezone');
const AttendanceRecord = require('../models/AttendanceRecord');
const { logger } = require('../utils/logger');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

// A checked-in record from a previous day with no checkout is incomplete, so
// count it as a half day when attendance is next read or used for payroll.
const markMissedCheckoutsAsHalfDay = async (userId = null) => {

    const today = moment.tz(TZ).startOf('day').toDate();
    const query = {
        date: { $lt: today },
        'checkIn.time': { $ne: null },
        'checkOut.time': null,
        status: { $in: ['present', 'wfh'] },
        isLocked: { $ne: true },
        // A correction that only re-timed check-in is still a missed
        // checkout; only an explicit admin status override is respected.
        isStatusOverridden: { $ne: true }
    };
    
    if (userId) query.user = userId;

    const result = await AttendanceRecord.updateMany(query, {
        $set: {
            status: 'half_day',
            isHalfDay: true,
            isAbsent: false,
            isEarlyLeave: false,
            earlyLeaveMinutes: 0,
            isOvertime: false,
            overtimeHours: 0,
            overtimeMinutes: 0,
            workingHours: 0,
            workingMinutes: 0
        }
    });

    if (result.modifiedCount > 0) {
        logger.info(`Marked ${result.modifiedCount} missed-checkout record(s) as half day`);
    }
};

module.exports = { markMissedCheckoutsAsHalfDay };
