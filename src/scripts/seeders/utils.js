// Small generic helpers shared by every seeder in this folder.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const pick = (arr) => arr[randInt(0, arr.length - 1)];

// Weighted pick: items is [{ value, weight }, ...]
const weightedPick = (items) => {
    const total = items.reduce((sum, i) => sum + i.weight, 0);
    let r = Math.random() * total;
    for (const item of items) {
        r -= item.weight;
        if (r <= 0) return item.value;
    }
    return items[items.length - 1].value;
};

// Returns true with the given probability (0-1).
const chance = (probability) => Math.random() < probability;

const digits = (count) => {
    let s = '';
    for (let i = 0; i < count; i++) s += randInt(0, 9);
    return s;
};

const letters = (count) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let s = '';
    for (let i = 0; i < count; i++) s += alphabet[randInt(0, alphabet.length - 1)];
    return s;
};

// PAN format: AAAAA9999A
const generatePAN = () => `${letters(5)}${digits(4)}${letters(1)}`;

// Aadhaar: 12 digits, displayed in 4-4-4 groups. Never starts with 0/1.
const generateAadhaar = () => `${randInt(2, 9)}${digits(3)} ${digits(4)} ${digits(4)}`;

// UAN-style PF account number: 12 digits.
const generatePFNumber = () => digits(12);

// ESIC insurance number: 10 digits.
const generateESICNumber = () => digits(10);

// IFSC: 4 letters + 0 + 6 alphanumeric.
const generateIFSC = (bankCode) => `${bankCode}0${digits(3)}${letters(3)}`.slice(0, 11);

// Bank account number: 11-16 digits.
const generateAccountNumber = () => digits(randInt(11, 16));

// Indian mobile number: starts 6-9, 10 digits total.
const generatePhone = () => `+91 ${randInt(6, 9)}${digits(9)}`;

module.exports = {
    round2,
    randInt,
    pick,
    weightedPick,
    chance,
    digits,
    letters,
    generatePAN,
    generateAadhaar,
    generatePFNumber,
    generateESICNumber,
    generateIFSC,
    generateAccountNumber,
    generatePhone
};
