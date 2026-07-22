const moment = require('moment');
const { AttendanceRecord, AttendanceCorrectionRequest, Holiday, WeekendConfig, LeaveRequest, EmployeeRule, AttendanceRule } = require('../../models');
const { pick, weightedPick, chance, randInt } = require('./utils');

// Offsets (minutes) applied to each employee's own shift check-in/check-out
// time, not a single hardcoded 09:00-18:00 assumption - so an employee on
// the Early Shift (08:00-17:00) or Evening Shift (13:00-22:00) still gets
// realistic times relative to *their* shift, exactly as the admin configured
// it via AttendanceRule (see setting.controller.js's attendance-rules CRUD).
const CHECK_IN_ON_TIME_OFFSETS = [-15, 5];
const CHECK_IN_LATE_OFFSETS = [20, 45];
const CHECK_OUT_OFFSETS = [-30, 0, 45, 75];

const toWeekday = (m) => {
    const clone = m.clone();
    const day = clone.day();
    if (day === 0) clone.add(1, 'day');
    else if (day === 6) clone.add(2, 'day');
    return clone;
};

const atTime = (date, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return date.clone().hour(h).minute(m).second(0).millisecond(0);
};

const atOffset = (date, hhmm, minutes) => atTime(date, hhmm).add(minutes, 'minutes');

// ---------------------------------------------------------------------------
// Foundational config: weekly off + holidays. Both are read by
// payroll.service.js's getMonthlyAttendanceSummary(), so they must exist
// before payroll/salary slips are generated.
//
// Default is Sunday-only off, Saturday a working day - the admin can flip
// Saturday to a week-off at any time via the existing PUT /api/weekends
// endpoints (weekend.routes.js); this seeder just picks a sane starting point.
// ---------------------------------------------------------------------------
const seedWeekendConfig = async () => {
    await WeekendConfig.insertMany([
        { dayOfWeek: 'sunday', isWeekend: true, isHalfDay: false, halfDayHours: 4 },
        { dayOfWeek: 'monday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
        { dayOfWeek: 'tuesday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
        { dayOfWeek: 'wednesday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
        { dayOfWeek: 'thursday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
        { dayOfWeek: 'friday', isWeekend: false, isHalfDay: false, halfDayHours: 4 },
        { dayOfWeek: 'saturday', isWeekend: false, isHalfDay: false, halfDayHours: 4 }
    ]);
    console.log('Weekend configuration seeded (Sunday off, Saturday a working day - admin can change this via PUT /api/weekends)');
};

const seedHolidays = async (admin) => {
    const holidays = await Holiday.insertMany([
        {
            name: 'Bakrid (Eid al-Adha)',
            date: toWeekday(moment('2026-06-05')).startOf('day').toDate(),
            description: 'Islamic festival of sacrifice',
            type: 'national',
            isActive: true,
            createdBy: admin._id
        },
        {
            name: 'FreightTrack Foundation Day',
            date: toWeekday(moment('2026-06-19')).startOf('day').toDate(),
            description: 'Company founding anniversary',
            type: 'company',
            isActive: true,
            createdBy: admin._id
        },
        {
            name: 'Independence Day',
            date: moment('2026-08-15').startOf('day').toDate(),
            description: 'National holiday',
            type: 'national',
            isActive: true,
            createdBy: admin._id
        }
    ]);
    console.log(`${holidays.length} holidays seeded`);
    return holidays;
};

// Resolves each employee's effective AttendanceRule (shift) exactly the way
// attendance.controller.js's getUserRule() does: their EmployeeRule
// assignment if one exists, otherwise the default rule.
const buildUserRuleMap = async (employees) => {
    const userIds = employees.map(e => e._id);
    const [assignments, defaultRule] = await Promise.all([
        EmployeeRule.find({ user: { $in: userIds } }).populate('rule'),
        AttendanceRule.findOne({ isDefault: true, isActive: true })
    ]);

    const map = new Map();
    assignments.forEach(a => { if (a.rule) map.set(a.user.toString(), a.rule); });
    employees.forEach(e => {
        if (!map.has(e._id.toString())) map.set(e._id.toString(), defaultRule);
    });
    return map;
};

// Expands every approved LeaveRequest overlapping [rangeStart, rangeEnd] into
// a Map<userId, Map<'YYYY-MM-DD', { isPaid, leaveTypeName }>>, the same shape
// payroll.service.js's getMonthlyAttendanceSummary() builds internally.
const buildApprovedLeaveMap = async (rangeStart, rangeEnd) => {
    const requests = await LeaveRequest.find({
        status: 'approved',
        startDate: { $lte: rangeEnd.toDate() },
        endDate: { $gte: rangeStart.toDate() }
    }).populate('leaveType', 'isPaid name');

    const map = new Map();
    requests.forEach(lr => {
        const start = moment.max(moment(lr.startDate), rangeStart);
        const end = moment.min(moment(lr.endDate), rangeEnd);
        const cursor = start.clone();
        const userKey = lr.user.toString();
        if (!map.has(userKey)) map.set(userKey, new Map());
        while (cursor.isSameOrBefore(end, 'day')) {
            map.get(userKey).set(cursor.format('YYYY-MM-DD'), {
                isPaid: lr.leaveType ? lr.leaveType.isPaid : false,
                leaveTypeName: lr.leaveType ? lr.leaveType.name : 'Leave'
            });
            cursor.add(1, 'day');
        }
    });
    return map;
};

// Builds a single day's AttendanceRecord payload for a normal working day
// (not weekend/holiday/leave), following the status mix from the spec:
// ~80% present, 5% half day, 5% late, 2% absent (the remaining present bucket
// also covers WFH/overtime/early-exit as flags layered on top). Every time
// is computed relative to `rule` - the employee's own assigned shift.
const buildWorkingDayRecord = (user, date, rule) => {
    const record = { user: user._id, date: date.toDate() };
    const ruleCheckIn = rule.checkInTime;
    const ruleCheckOut = rule.checkOutTime;
    const halfDayHours = rule.halfDayHours || 4;
    const overtimeThreshold = rule.overtimeThreshold || 8;

    const bucket = weightedPick([
        { value: 'present_normal', weight: 74 },
        { value: 'present_late', weight: 5 },
        { value: 'present_wfh', weight: 6 },
        { value: 'half_day', weight: 5 },
        { value: 'absent', weight: 2 }
    ]);

    if (bucket === 'absent') {
        record.status = 'absent';
        record.workingHours = 0;
        return record;
    }

    if (bucket === 'half_day') {
        const checkIn = atOffset(date, ruleCheckIn, pick(CHECK_IN_ON_TIME_OFFSETS));
        const checkOut = checkIn.clone().add(halfDayHours, 'hours');
        record.checkIn = { time: checkIn.toDate(), location: 'Office', device: 'Web' };
        record.checkOut = { time: checkOut.toDate(), location: 'Office', device: 'Web' };
        record.workingHours = parseFloat(checkOut.diff(checkIn, 'hours', true).toFixed(2));
        record.status = 'half_day';
        record.isEarlyLeave = true;
        record.earlyLeaveMinutes = Math.round(atTime(date, ruleCheckOut).diff(checkOut, 'minutes'));
        return record;
    }

    const isLate = bucket === 'present_late';
    const isWfh = bucket === 'present_wfh';
    const checkInTime = atOffset(date, ruleCheckIn, pick(isLate ? CHECK_IN_LATE_OFFSETS : CHECK_IN_ON_TIME_OFFSETS));

    const isOvertimeDay = !isLate && chance(0.1);
    const isEarlyLeaveDay = !isLate && !isOvertimeDay && chance(0.05);

    let checkOutTime;
    if (isOvertimeDay) {
        checkOutTime = atOffset(date, ruleCheckOut, 75 + randInt(0, 45));
    } else if (isEarlyLeaveDay) {
        checkOutTime = atOffset(date, ruleCheckOut, -randInt(60, 105));
    } else {
        checkOutTime = atOffset(date, ruleCheckOut, pick(CHECK_OUT_OFFSETS));
    }

    const workingHours = parseFloat(checkOutTime.diff(checkInTime, 'hours', true).toFixed(2));

    record.checkIn = { time: checkInTime.toDate(), location: isWfh ? 'Home' : 'Office', device: isWfh ? 'Mobile' : 'Web' };
    record.checkOut = { time: checkOutTime.toDate(), location: isWfh ? 'Home' : 'Office', device: isWfh ? 'Mobile' : 'Web' };
    record.workingHours = workingHours;
    record.status = isWfh ? 'wfh' : 'present';

    if (isLate) {
        record.isLate = true;
        record.lateMinutes = Math.round(checkInTime.diff(atTime(date, ruleCheckIn), 'minutes'));
    }
    if (isOvertimeDay) {
        record.isOvertime = true;
        record.overtimeHours = parseFloat((workingHours - overtimeThreshold).toFixed(2));
    }
    if (isEarlyLeaveDay) {
        record.isEarlyLeave = true;
        record.earlyLeaveMinutes = Math.round(atTime(date, ruleCheckOut).diff(checkOutTime, 'minutes'));
    }

    return record;
};

// Generates attendance for every active employee across [rangeStart, rangeEnd],
// respecting weekends/holidays/approved leave/each employee's own shift.
// Returns records grouped by user.
const generateAttendanceRange = async (employees, rangeStart, rangeEnd, weekendDayNames, holidayDateSet) => {
    const [approvedLeaveMap, ruleMap] = await Promise.all([
        buildApprovedLeaveMap(rangeStart, rangeEnd),
        buildUserRuleMap(employees)
    ]);
    const byUser = {};

    for (const emp of employees) {
        const records = [];
        const userLeaves = approvedLeaveMap.get(emp._id.toString());
        const rule = ruleMap.get(emp._id.toString());
        const cursor = rangeStart.clone();

        while (cursor.isSameOrBefore(rangeEnd, 'day')) {
            const dayName = cursor.format('dddd').toLowerCase();
            const dateKey = cursor.format('YYYY-MM-DD');

            if (weekendDayNames.has(dayName)) {
                records.push({ user: emp._id, date: cursor.clone().startOf('day').toDate(), status: 'weekend' });
            } else if (holidayDateSet.has(dateKey)) {
                records.push({ user: emp._id, date: cursor.clone().startOf('day').toDate(), status: 'holiday' });
            } else if (userLeaves && userLeaves.has(dateKey)) {
                const leave = userLeaves.get(dateKey);
                records.push({
                    user: emp._id,
                    date: cursor.clone().startOf('day').toDate(),
                    status: 'on_leave',
                    notes: `Leave: ${leave.leaveTypeName}${leave.isPaid ? '' : ' (unpaid)'}`
                });
            } else if (cursor.isSameOrBefore(moment(), 'day')) {
                records.push(buildWorkingDayRecord(emp, cursor.clone().startOf('day'), rule));
            } else {
                cursor.add(1, 'day');
                continue;
            }

            cursor.add(1, 'day');
        }

        if (records.length) {
            byUser[emp._id.toString()] = await AttendanceRecord.insertMany(records);
        }
    }

    return byUser;
};

const seedAttendanceCorrections = async (attendanceByUser, employees) => {
    const candidates = [];
    for (const emp of employees) {
        const records = attendanceByUser[emp._id.toString()] || [];
        const lateRecord = records.find(r => r.isLate);
        const halfDayRecord = records.find(r => r.status === 'half_day');
        if (lateRecord) candidates.push({ emp, record: lateRecord, type: 'late' });
        if (halfDayRecord) candidates.push({ emp, record: halfDayRecord, type: 'half_day' });
    }

    const selected = candidates.slice(0, 6);
    for (const { emp, record, type } of selected) {
        if (type === 'late') {
            await AttendanceCorrectionRequest.create({
                user: emp._id,
                attendanceRecord: record._id,
                date: record.date,
                requestedCheckIn: moment(record.date).hour(9).minute(5).toDate(),
                reason: 'Biometric device malfunction, actual check-in time was earlier',
                status: 'pending'
            });
        } else {
            await AttendanceCorrectionRequest.create({
                user: emp._id,
                attendanceRecord: record._id,
                date: record.date,
                requestedCheckOut: moment(record.date).hour(18).minute(0).toDate(),
                reason: 'Stayed back for client call, checkout was not recorded',
                status: 'pending'
            });
        }
    }
    console.log(`${selected.length} pending attendance correction requests created`);
};

const seedAttendanceJune2026 = async (employees, admin) => {
    await seedWeekendConfig();
    const holidays = await seedHolidays(admin);

    const activeWeekendConfigs = await WeekendConfig.find({ isWeekend: true });
    const weekendDayNames = new Set(activeWeekendConfigs.map(w => w.dayOfWeek));
    const holidayDateSet = new Set(holidays.map(h => moment(h.date).format('YYYY-MM-DD')));

    const activeEmployees = employees.filter(e => e.isActive);
    const juneStart = moment('2026-06-01').startOf('day');
    const juneEnd = moment('2026-06-30').endOf('day');

    const attendanceByUser = await generateAttendanceRange(activeEmployees, juneStart, juneEnd, weekendDayNames, holidayDateSet);
    const totalJuneRecords = Object.values(attendanceByUser).reduce((sum, r) => sum + r.length, 0);
    console.log(`June 2026 attendance generated: ${totalJuneRecords} records across ${activeEmployees.length} active employees`);

    await seedAttendanceCorrections(attendanceByUser, activeEmployees);

    // Bonus: also populate the current real-world period (this month to
    // today) so the admin dashboard's "today"/"this month" cards - which
    // read off the live server date, not a query param - aren't empty when
    // viewed right after seeding. Purely additive to the June 2026 dataset.
    const today = moment();
    const currentMonthStart = today.clone().startOf('month');
    if (!currentMonthStart.isSame(juneStart, 'month')) {
        const bonusByUser = await generateAttendanceRange(activeEmployees, currentMonthStart, today.clone().endOf('day'), weekendDayNames, new Set());
        const bonusCount = Object.values(bonusByUser).reduce((sum, r) => sum + r.length, 0);
        console.log(`Bonus: current-period attendance (${currentMonthStart.format('MMMM YYYY')} to today) generated: ${bonusCount} records, so the live admin dashboard also shows data`);
    }

    return { attendanceByUser, holidays };
};

module.exports = seedAttendanceJune2026;
