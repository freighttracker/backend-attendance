const moment = require('moment');
const { Bonus, Reimbursement } = require('../../models');
const { pick, chance, randInt, weightedPick } = require('./utils');

const REIMBURSEMENT_RANGES = {
    travel: [800, 4500],
    fuel: [500, 2500],
    internet: [400, 1200],
    medical: [500, 6000],
    food: [300, 1800],
    other: [300, 3000]
};
const REIMBURSEMENT_DESCRIPTIONS = {
    travel: 'Client site visit travel expense',
    fuel: 'Fuel expense for field visit',
    internet: 'Monthly broadband/mobile data reimbursement',
    medical: 'Medical expense reimbursement',
    food: 'Business meal / team outing expense',
    other: 'Miscellaneous work-related expense'
};

const BONUS_RANGES = {
    monthly: [1500, 4000],
    performance: [3000, 12000],
    festival: [2000, 8000],
    yearly: [10000, 40000]
};
const BONUS_DESCRIPTIONS = {
    monthly: 'Monthly attendance/performance bonus',
    performance: 'Outstanding project delivery bonus',
    festival: 'Festival bonus',
    yearly: 'Annual performance bonus'
};

const MONTH = 6;
const YEAR = 2026;

// Reimbursements: "payroll expenses" - travel/internet/food/medical/fuel/other.
const seedReimbursements = async (activeEmployees, admin) => {
    let count = 0;
    for (const emp of activeEmployees) {
        if (!chance(0.3)) continue;

        const category = weightedPick([
            { value: 'travel', weight: 25 },
            { value: 'internet', weight: 25 },
            { value: 'food', weight: 20 },
            { value: 'medical', weight: 15 },
            { value: 'fuel', weight: 10 },
            { value: 'other', weight: 5 }
        ]);
        const [min, max] = REIMBURSEMENT_RANGES[category];
        const status = weightedPick([
            { value: 'approved', weight: 70 },
            { value: 'pending', weight: 20 },
            { value: 'rejected', weight: 10 }
        ]);

        const payload = {
            user: emp._id,
            category,
            amount: randInt(min, max),
            description: REIMBURSEMENT_DESCRIPTIONS[category],
            expenseDate: moment('2026-06-01').date(randInt(2, 27)).toDate(),
            month: MONTH,
            year: YEAR,
            status
        };
        if (status === 'approved' || status === 'paid') {
            payload.approvedBy = admin._id;
            payload.approvedAt = new Date();
        }
        if (status === 'rejected') {
            payload.approvedBy = admin._id;
            payload.approvedAt = new Date();
            payload.rejectionReason = 'Missing bill / insufficient documentation';
        }

        await Reimbursement.create(payload);
        count += 1;
    }
    console.log(`${count} reimbursements created for June 2026`);
};

// Bonuses: monthly/performance/festival/yearly, mostly approved so payroll
// generation for June 2026 picks them up automatically.
const seedBonuses = async (activeEmployees, admin) => {
    let count = 0;
    for (const emp of activeEmployees) {
        if (!chance(0.2)) continue;

        const bonusType = weightedPick([
            { value: 'performance', weight: 40 },
            { value: 'monthly', weight: 30 },
            { value: 'festival', weight: 20 },
            { value: 'yearly', weight: 10 }
        ]);
        const [min, max] = BONUS_RANGES[bonusType];
        const status = weightedPick([
            { value: 'approved', weight: 80 },
            { value: 'pending', weight: 15 },
            { value: 'rejected', weight: 5 }
        ]);

        const payload = {
            user: emp._id,
            bonusType,
            amount: randInt(min, max),
            month: MONTH,
            year: YEAR,
            description: BONUS_DESCRIPTIONS[bonusType],
            status,
            createdBy: admin._id
        };
        if (status === 'approved') {
            payload.approvedBy = admin._id;
            payload.approvedAt = new Date();
        }
        if (status === 'rejected') {
            payload.rejectionReason = 'Budget constraints for this cycle';
        }

        await Bonus.create(payload);
        count += 1;
    }
    console.log(`${count} bonuses created for June 2026`);
};

const seedExpenses = async (employees, admin) => {
    const activeEmployees = employees.filter(e => e.isActive);
    await seedReimbursements(activeEmployees, admin);
    await seedBonuses(activeEmployees, admin);
};

module.exports = seedExpenses;
