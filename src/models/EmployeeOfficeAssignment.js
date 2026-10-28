const mongoose = require('mongoose');

// Which offices an employee may check in/out at. Deactivated rows are kept
// (never deleted) so past attendance can still be explained.
const employeeOfficeAssignmentSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    office: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OfficeLocation',
        required: true
    },
    // Copied from the employee's own record so assignments can be scoped
    // without a join back through User.
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        default: null
    },
    isPrimary: {
        type: Boolean,
        default: false
    },
    effectiveFrom: {
        type: Date,
        default: null
    },
    effectiveTo: {
        type: Date,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    },
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    deactivatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    deactivatedAt: Date
}, {
    timestamps: true
});

// At most one active assignment per employee+office; old ones stay inactive.
employeeOfficeAssignmentSchema.index(
    { user: 1, office: 1 },
    { unique: true, partialFilterExpression: { isActive: true } }
);
employeeOfficeAssignmentSchema.index({ user: 1, isActive: 1 });
employeeOfficeAssignmentSchema.index({ office: 1, isActive: 1 });

module.exports = mongoose.model('EmployeeOfficeAssignment', employeeOfficeAssignmentSchema);
