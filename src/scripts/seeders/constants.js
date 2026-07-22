// ---------------------------------------------------------------------------
// Shared, hand-picked reference data for the seeders in this folder.
//
// The schema has no separate Department/Designation/Branch collections -
// `department` and `designation` are free-text fields on User (see
// src/models/User.js) - so these lists exist only as in-memory constants
// that every seeder imports from here to stay consistent, rather than as
// rows in the database.
// ---------------------------------------------------------------------------

const DEPARTMENTS = [
    'HR',
    'Accounts',
    'Sales',
    'Marketing',
    'IT',
    'Support',
    'Operations',
    'Logistics',
    'Warehouse',
    'Management'
];

// Which designations are valid in each department, and a rough monthly
// gross salary band (INR) used by seedSalaryStructures.js. First entry in
// each department's list is treated as that department's "head" designation
// when picking a reporting manager.
const DEPARTMENT_DESIGNATIONS = {
    Management: [
        { title: 'CEO', min: 250000, max: 400000, isHead: true }
    ],
    HR: [
        { title: 'HR Manager', min: 80000, max: 120000, isHead: true }
    ],
    Accounts: [
        { title: 'Accountant', min: 35000, max: 60000, isHead: true }
    ],
    IT: [
        { title: 'Software Developer', min: 45000, max: 55000, isHead: true },
        { title: 'Frontend Developer', min: 40000, max: 70000 },
        { title: 'Backend Developer', min: 45000, max: 75000 },
        { title: 'UI Designer', min: 35000, max: 60000 }
    ],
    Sales: [
        { title: 'Sales Manager', min: 60000, max: 100000, isHead: true },
        { title: 'Sales Executive', min: 25000, max: 40000 }
    ],
    Marketing: [
        { title: 'Marketing Executive', min: 28000, max: 45000, isHead: true }
    ],
    Support: [
        { title: 'Support Executive', min: 22000, max: 35000, isHead: true }
    ],
    Operations: [
        { title: 'Operations Manager', min: 55000, max: 90000, isHead: true }
    ],
    Logistics: [
        { title: 'Logistics Executive', min: 25000, max: 40000, isHead: true }
    ],
    Warehouse: [
        { title: 'Warehouse Manager', min: 45000, max: 70000, isHead: true }
    ]
};

const EMPLOYMENT_TYPES = ['full-time', 'full-time', 'full-time', 'full-time', 'part-time', 'contract', 'intern'];

// Branch / location pairs an employee can be assigned to.
const BRANCHES = [
    { branch: 'Mumbai HQ', location: 'Mumbai, Maharashtra' },
    { branch: 'Delhi Branch', location: 'New Delhi, Delhi' },
    { branch: 'Bangalore Branch', location: 'Bengaluru, Karnataka' },
    { branch: 'Chennai Branch', location: 'Chennai, Tamil Nadu' },
    { branch: 'Pune Branch', location: 'Pune, Maharashtra' },
    { branch: 'Ahmedabad Branch', location: 'Ahmedabad, Gujarat' }
];

const BANKS = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Punjab National Bank', 'Kotak Mahindra Bank', 'Yes Bank', 'IDFC First Bank'];

const BANK_CODES = {
    'HDFC Bank': 'HDFC',
    'ICICI Bank': 'ICIC',
    'State Bank of India': 'SBIN',
    'Axis Bank': 'UTIB',
    'Punjab National Bank': 'PUNB',
    'Kotak Mahindra Bank': 'KKBK',
    'Yes Bank': 'YESB',
    'IDFC First Bank': 'IDFB'
};

// Modelled as AttendanceRule documents (existing schema) rather than a new
// "shift" field - a rule already captures check-in/out time + grace period,
// which is exactly what a shift is.
const SHIFT_DEFS = [
    { ruleName: 'General Shift (09:00 - 18:00)', checkInTime: '09:00', checkOutTime: '18:00', weight: 70 },
    { ruleName: 'Early Shift (08:00 - 17:00)', checkInTime: '08:00', checkOutTime: '17:00', weight: 15 },
    { ruleName: 'Evening Shift (13:00 - 22:00)', checkInTime: '13:00', checkOutTime: '22:00', weight: 15 }
];

const COMPANY_PROFILE = {
    name: 'FreightTrack Logistics Pvt. Ltd.',
    address: 'Plot 14, Andheri-Kurla Road, Andheri East, Mumbai, Maharashtra 400059',
    pan: 'AAFCF1234K',
    bankName: 'HDFC Bank'
};

// Employee headcount per department - sums to 92 (within the requested 75-100).
const DEPARTMENT_HEADCOUNT = {
    Management: 1,
    HR: 5,
    Accounts: 7,
    IT: 15,
    Sales: 18,
    Marketing: 8,
    Support: 10,
    Operations: 8,
    Logistics: 10,
    Warehouse: 10
};

module.exports = {
    DEPARTMENTS,
    DEPARTMENT_DESIGNATIONS,
    DEPARTMENT_HEADCOUNT,
    EMPLOYMENT_TYPES,
    BRANCHES,
    BANKS,
    BANK_CODES,
    SHIFT_DEFS,
    COMPANY_PROFILE
};
