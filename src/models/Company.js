const mongoose = require('mongoose');

// Top of the hierarchy under Super Admin: Company -> SubCompany -> Users ->
// business data. A Company itself has no "owner" reference since only a
// superadmin/admin can ever create one (enforced at the route level).
const companySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Company name is required'],
        trim: true
    },
    code: {
        type: String,
        required: [true, 'Company code is required'],
        trim: true,
        uppercase: true,
        unique: true
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
    // GST/VAT/tax registration number - optional, name kept generic since it
    // varies by country rather than being India-specific.
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

companySchema.index({ code: 1 }, { unique: true });
companySchema.index({ isActive: 1 });
companySchema.index({ name: 1 });
companySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Company', companySchema);
