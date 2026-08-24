const mongoose = require('mongoose');

// A SubCompany always belongs to exactly one Company. Its own `code` only
// needs to be unique within that parent (two different companies may each
// have a "HQ" subcompany), so the uniqueness index is compound.
const subCompanySchema = new mongoose.Schema({
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: [true, 'Parent company is required']
    },
    name: {
        type: String,
        required: [true, 'Subcompany name is required'],
        trim: true
    },
    code: {
        type: String,
        required: [true, 'Subcompany code is required'],
        trim: true,
        uppercase: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        trim: true
    },
    address: {
        type: String,
        trim: true
    },
    city: {
        type: String,
        trim: true
    },
    state: {
        type: String,
        trim: true
    },
    country: {
        type: String,
        trim: true,
        default: 'India'
    },
    taxNumber: {
        type: String,
        trim: true
    },
    website: {
        type: String,
        trim: true
    },
    contactPerson: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

subCompanySchema.index({ company: 1, code: 1 }, { unique: true });
subCompanySchema.index({ company: 1 });
subCompanySchema.index({ isActive: 1 });
subCompanySchema.index({ createdAt: -1 });

module.exports = mongoose.model('SubCompany', subCompanySchema);
