const { faker } = require('@faker-js/faker');
const moment = require('moment');
const { User, AttendanceRule, EmployeeRule, SystemSetting } = require('../../models');
const {
    DEPARTMENT_DESIGNATIONS,
    DEPARTMENT_HEADCOUNT,
    EMPLOYMENT_TYPES,
    BRANCHES,
    BANKS,
    BANK_CODES,
    SHIFT_DEFS,
    COMPANY_PROFILE
} = require('./constants');
const {
    randInt,
    pick,
    weightedPick,
    chance,
    generatePAN,
    generateAadhaar,
    generatePFNumber,
    generateESICNumber,
    generateIFSC,
    generateAccountNumber,
    generatePhone
} = require('./utils');
const { MALE_FIRST_NAMES, FEMALE_FIRST_NAMES, NEUTRAL_FIRST_NAMES, LAST_NAMES, RELATIONS } = require('./indianNames');

const EMPLOYEE_PASSWORD = 'Employee@123';
const EMPLOYEE_CODE_START = 1001;

// Round a salary to the nearest 500 so figures look like real payroll bands
// rather than uniform random noise.
const roundSalary = (n) => Math.round(n / 500) * 500;

const pickGender = () => weightedPick([
    { value: 'male', weight: 60 },
    { value: 'female', weight: 38 },
    { value: 'other', weight: 2 }
]);

const pickName = (gender) => {
    const firstName = gender === 'male'
        ? faker.helpers.arrayElement(MALE_FIRST_NAMES)
        : gender === 'female'
            ? faker.helpers.arrayElement(FEMALE_FIRST_NAMES)
            : faker.helpers.arrayElement(NEUTRAL_FIRST_NAMES);
    const lastName = faker.helpers.arrayElement(LAST_NAMES);
    return { firstName, lastName };
};

// ---------------------------------------------------------------------------
// Foundational, org-wide setup: company profile settings + AttendanceRule
// "shifts" (the existing schema's stand-in for a Shift concept - see
// AttendanceRule/EmployeeRule models).
// ---------------------------------------------------------------------------
const seedCompanyProfile = async () => {
    await SystemSetting.deleteMany({ settingKey: { $in: ['company_name', 'company_address', 'company_pan', 'company_bank_name', 'default_currency', 'payroll_late_policy', 'enable_auto_lock', 'lock_after_days', 'payroll_cycle_day'] } });
    await SystemSetting.insertMany([
        { settingKey: 'company_name', settingValue: COMPANY_PROFILE.name, settingType: 'string', description: 'Company name displayed in the system' },
        { settingKey: 'company_address', settingValue: COMPANY_PROFILE.address, settingType: 'string', description: 'Company address' },
        { settingKey: 'company_pan', settingValue: COMPANY_PROFILE.pan, settingType: 'string', description: 'Company PAN shown on salary slips' },
        { settingKey: 'company_bank_name', settingValue: COMPANY_PROFILE.bankName, settingType: 'string', description: 'Company bank name shown on salary slips' },
        { settingKey: 'default_currency', settingValue: 'INR', settingType: 'string', description: 'Default currency for salary' },
        { settingKey: 'payroll_cycle_day', settingValue: '1', settingType: 'number', description: 'Day of month when payroll cycle starts' },
        { settingKey: 'enable_auto_lock', settingValue: 'true', settingType: 'boolean', description: 'Auto-lock attendance/payroll after generation' },
        { settingKey: 'lock_after_days', settingValue: '5', settingType: 'number', description: 'Days after month end to auto-lock' },
        {
            settingKey: 'payroll_late_policy',
            settingValue: [
                { lateCount: 3, deductionDays: 0.5 },
                { lateCount: 6, deductionDays: 1 }
            ],
            settingType: 'json',
            description: 'Late-mark thresholds and the equivalent day(s) of salary deducted once reached'
        }
    ]);
    console.log(`Company profile settings seeded (${COMPANY_PROFILE.name})`);
};

const seedShifts = async () => {
    const rules = [];
    for (let i = 0; i < SHIFT_DEFS.length; i++) {
        const def = SHIFT_DEFS[i];
        const rule = await AttendanceRule.create({
            ruleName: def.ruleName,
            checkInTime: def.checkInTime,
            checkOutTime: def.checkOutTime,
            gracePeriodMinutes: 15,
            halfDayHours: 4,
            fullDayHours: 8,
            overtimeThreshold: 8,
            overtimeRateMultiplier: 1.5,
            lateMarkAfterMinutes: 15,
            earlyLeaveBeforeMinutes: 15,
            maxLateCountPerMonth: 3,
            maxEarlyLeaveCountPerMonth: 3,
            isDefault: i === 0,
            isActive: true
        });
        rules.push({ ...def, doc: rule });
    }
    console.log(`${rules.length} shifts (AttendanceRule) created`);
    return rules;
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------
const seedEmployees = async (admin, { inactiveCount = 5 } = {}) => {
    await seedCompanyProfile();
    const shifts = await seedShifts();

    const usedEmails = new Set();
    const buildEmail = (firstName, lastName) => {
        const base = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '');
        let email = `${base}@freighttrack.com`;
        let suffix = 1;
        while (usedEmails.has(email)) {
            email = `${base}${suffix}@freighttrack.com`;
            suffix += 1;
        }
        usedEmails.add(email);
        return email;
    };

    const departments = Object.keys(DEPARTMENT_HEADCOUNT);
    const created = [];
    const departmentHeadIds = {};
    let codeSeq = EMPLOYEE_CODE_START;

    for (const department of departments) {
        const headcount = DEPARTMENT_HEADCOUNT[department];
        const designations = DEPARTMENT_DESIGNATIONS[department];
        const headDesignation = designations.find(d => d.isHead) || designations[0];
        const nonHeadDesignations = designations.filter(d => d !== headDesignation);

        let departmentHeadId = null;

        for (let i = 0; i < headcount; i++) {
            const isHead = i === 0;
            const designation = isHead
                ? headDesignation
                : (nonHeadDesignations.length ? pick(nonHeadDesignations) : headDesignation);

            const gender = pickGender();
            const { firstName, lastName } = pickName(gender);
            const email = buildEmail(firstName, lastName);
            const employeeCode = `FT${codeSeq}`;
            codeSeq += 1;

            const dob = faker.date.between({
                from: isHead ? '1970-01-01' : '1985-01-01',
                to: isHead ? '1985-12-31' : '2003-12-31'
            });
            const joiningDate = faker.date.between({
                from: isHead ? '2019-01-01' : '2020-06-01',
                to: '2026-05-15'
            });

            const branchInfo = pick(BRANCHES);
            const bankName = pick(BANKS);
            const monthlyGrossSalary = roundSalary(randInt(designation.min, designation.max));
            const employmentType = department === 'Management' ? 'full-time' : pick(EMPLOYMENT_TYPES);

            const user = await User.create({
                employeeCode,
                email,
                password: EMPLOYEE_PASSWORD,
                firstName,
                lastName,
                phone: generatePhone(),
                avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(`${firstName} ${lastName}`)}&background=random&color=fff`,
                role: isHead ? 'manager' : 'employee',
                department,
                designation: designation.title,
                joiningDate,
                dateOfBirth: dob,
                gender,
                address: {
                    street: faker.location.streetAddress(),
                    city: branchInfo.location.split(',')[0].trim(),
                    state: branchInfo.location.split(',')[1].trim(),
                    zipCode: String(randInt(100000, 999999)),
                    country: 'India'
                },
                emergencyContact: {
                    name: `${pick([...MALE_FIRST_NAMES, ...FEMALE_FIRST_NAMES])} ${pick(LAST_NAMES)}`,
                    phone: generatePhone(),
                    relation: pick(RELATIONS)
                },
                baseSalary: monthlyGrossSalary,
                bankDetails: {
                    bankName,
                    accountNumber: generateAccountNumber(),
                    ifscCode: generateIFSC(BANK_CODES[bankName]),
                    branch: `${branchInfo.location.split(',')[0].trim()} Branch`
                },
                panNumber: generatePAN(),
                employmentType,
                reportingManager: departmentHeadId,
                aadhaarNumber: generateAadhaar(),
                pfNumber: generatePFNumber(),
                esicNumber: monthlyGrossSalary <= 21000 ? generateESICNumber() : undefined,
                branch: branchInfo.branch,
                location: branchInfo.location,
                isActive: true,
                isVerified: true
            });

            if (isHead) {
                departmentHeadId = user._id;
                departmentHeadIds[department] = user._id;
            }

            const shift = weightedPick(shifts.map(s => ({ value: s, weight: s.weight })));
            await EmployeeRule.create({
                user: user._id,
                rule: shift.doc._id,
                effectiveFrom: moment(joiningDate).startOf('day').toDate()
            });

            created.push({ user, shift: shift.doc, monthlyGrossSalary });
        }
    }

    // CEO reports to nobody; every department head reports to the CEO. Uses
    // the head's actual id (recorded above) rather than matching by
    // designation title, since several departments only have one
    // designation and every employee in them would otherwise match.
    const ceo = created.find(c => c.user.department === 'Management');
    for (const [department, headId] of Object.entries(departmentHeadIds)) {
        if (department === 'Management') continue;
        const headEntry = created.find(c => c.user._id.toString() === headId.toString());
        headEntry.user.reportingManager = ceo.user._id;
        await headEntry.user.save();
    }

    // Mark a handful of employees (never a department head/CEO) inactive to
    // give the "Status" field real variety without breaking June attendance
    // completeness for the active roster.
    const inactiveCandidates = created.filter(c => c.user._id.toString() !== ceo.user._id.toString() && c.user.reportingManager);
    const toDeactivate = faker.helpers.arrayElements(inactiveCandidates, Math.min(inactiveCount, inactiveCandidates.length));
    for (const entry of toDeactivate) {
        entry.user.isActive = false;
        await entry.user.save();
    }

    console.log(`${created.length} employees created across ${departments.length} departments (${toDeactivate.length} marked inactive)`);
    console.log(`Employee login password (all employees): ${EMPLOYEE_PASSWORD}`);

    return {
        employees: created.map(c => c.user),
        activeEmployees: created.filter(c => c.user.isActive).map(c => c.user),
        salaryByUserId: created.reduce((map, c) => { map[c.user._id.toString()] = c.monthlyGrossSalary; return map; }, {}),
        shifts
    };
};

module.exports = seedEmployees;
