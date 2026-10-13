// An employee who has left is deactivated (isActive: false) with a leftAt
// date, never deleted - so month-based screens (salary, payroll, attendance
// reports) can keep showing them for the months they actually worked and
// drop them from every month after.

const moment = require('moment-timezone');

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

// First instant of a calendar month, in UTC to match how leftAt is stored
// (a plain YYYY-MM-DD from the admin's date picker).
const monthStartUTC = (month, year) => new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));

// Mongo filter: still employed, or left on/after `fromDate`. Wrapped in $and
// so it can be spread next to a search `$or` without clobbering it.
const workedSince = (fromDate) => ({
    $and: [{ $or: [{ isActive: true }, { isActive: false, leftAt: { $gte: fromDate } }] }]
});

// Same rule for a single already-loaded user.
const hadLeftBefore = (user, fromDate) => !user.isActive && (!user.leftAt || user.leftAt < fromDate);

// Last working day as YYYY-MM-DD, or null while still employed. leftAt is
// normally a date-only value from the admin's date picker (UTC midnight);
// the legacy deactivate path stamps the actual instant instead, which is
// read in the office timezone.
const lastWorkingDayStr = (user) => {
    if (!user || user.isActive || !user.leftAt) return null;
    const d = new Date(user.leftAt);
    const isDateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
    return isDateOnly ? d.toISOString().slice(0, 10) : moment.tz(d, TZ).format('YYYY-MM-DD');
};

module.exports = { monthStartUTC, workedSince, hadLeftBefore, lastWorkingDayStr };
