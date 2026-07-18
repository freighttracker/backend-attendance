const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    employeeCode: {
        type: String,
        required: [true, 'Employee code is required'],
        unique: true,
        trim: true,
        uppercase: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false
    },
    firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true
    },
    lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true
    },
    phone: {
        type: String,
        trim: true
    },
    avatarUrl: {
        type: String,
        default: null
    },
    role: {
        type: String,
        enum: ['admin', 'employee', 'manager'],
        default: 'employee'
    },
    department: {
        type: String,
        trim: true
    },
    designation: {
        type: String,
        trim: true
    },
    joiningDate: {
        type: Date
    },
    dateOfBirth: {
        type: Date
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other']
    },
    address: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: { type: String, default: 'India' }
    },
    emergencyContact: {
        name: String,
        phone: String,
        relation: String
    },
    baseSalary: {
        type: Number,
        default: 0,
        min: 0
    },
    salary: {
        type: [{
            fieldId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalaryField' },
            code: String,
            value: mongoose.Schema.Types.Mixed,
            _id: false
        }],
        default: []
    },
    bankDetails: {
        bankName: String,
        accountNumber: String,
        ifscCode: String,
        branch: String
    },
    panNumber: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    lastLogin: {
        type: Date
    },
    loginAttempts: {
        type: Number,
        default: 0
    },
    lockUntil: {
        type: Date
    },
    refreshToken: {
        type: String,
        select: false
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
    return `${this.firstName} ${this.lastName}`;
});

// Index for search
userSchema.index({ employeeCode: 1 });
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ department: 1 });
userSchema.index({ isActive: 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
userSchema.methods.isLocked = function() {
    return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts
userSchema.methods.incLoginAttempts = async function() {
    if (this.lockUntil && this.lockUntil < Date.now()) {
        return this.updateOne({
            $set: { loginAttempts: 1 },
            $unset: { lockUntil: 1 }
        });
    }
    const updates = { $inc: { loginAttempts: 1 } };
    if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
        updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
    }
    return this.updateOne(updates);
};

module.exports = mongoose.model('User', userSchema);
