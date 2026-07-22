// ---------------------------------------------------------------------------
// There is no Department or Designation collection in this schema - `User`
// stores both as free-text (src/models/User.js). Per the "do not create new
// models" constraint, this seeder does not invent one; instead it is the
// single source of truth for the department/designation/shift constants
// every other seeder pulls from constants.js, and prints a summary so a
// `npm run seed` run still shows what "seedDepartments" produced.
// ---------------------------------------------------------------------------

const { DEPARTMENTS, DEPARTMENT_DESIGNATIONS, SHIFT_DEFS } = require('./constants');

const seedDepartments = async () => {
    const designationCount = Object.values(DEPARTMENT_DESIGNATIONS).reduce((sum, list) => sum + list.length, 0);

    console.log(`Departments (${DEPARTMENTS.length}): ${DEPARTMENTS.join(', ')}`);
    console.log(`Designations (${designationCount}) mapped across departments`);
    console.log(`Shifts (${SHIFT_DEFS.length}): ${SHIFT_DEFS.map(s => s.ruleName).join(', ')}`);

    return { departments: DEPARTMENTS, designations: DEPARTMENT_DESIGNATIONS, shifts: SHIFT_DEFS };
};

module.exports = seedDepartments;
