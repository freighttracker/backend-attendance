const mongoose = require('mongoose');

// A physical office an employee can be assigned to and check in/out at.
// company/subCompany follow the same tenant-scoping convention as User and
// AttendanceRecord, so scopeFilter/isInScope work on offices unchanged.
const officeLocationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Office name is required'],
        trim: true,
        maxlength: [120, 'Office name must be at most 120 characters']
    },
    code: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: [30, 'Office code must be at most 30 characters']
    },
    address: {
        type: String,
        required: [true, 'Address is required'],
        trim: true,
        maxlength: [500, 'Address must be at most 500 characters']
    },
    latitude: {
        type: Number,
        required: [true, 'Latitude is required'],
        min: [-90, 'Latitude must be between -90 and 90'],
        max: [90, 'Latitude must be between -90 and 90']
    },
    longitude: {
        type: Number,
        required: [true, 'Longitude is required'],
        min: [-180, 'Longitude must be between -180 and 180'],
        max: [180, 'Longitude must be between -180 and 180']
    },
    radiusMeters: {
        type: Number,
        required: [true, 'Geofence radius is required'],
        min: [10, 'Geofence radius must be at least 10 metres'],
        max: [5000, 'Geofence radius must be at most 5000 metres']
    },
    // Office-specific overrides of the company AttendanceGeoPolicy. null
    // means "use the policy value".
    maxAccuracyMeters: {
        type: Number,
        default: null,
        min: [5, 'Maximum GPS accuracy must be at least 5 metres'],
        max: [2000, 'Maximum GPS accuracy must be at most 2000 metres']
    },
    // Lets an office accept only one of the two actions (e.g. a client site
    // where staff may check out but must check in at the main office).
    allowCheckIn: {
        type: Boolean,
        default: true
    },
    allowCheckOut: {
        type: Boolean,
        default: true
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        default: null
    },
    subCompany: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SubCompany',
        default: null
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

officeLocationSchema.index({ company: 1, isActive: 1 });
officeLocationSchema.index({ subCompany: 1 });
officeLocationSchema.index({ company: 1, code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });

module.exports = mongoose.model('OfficeLocation', officeLocationSchema);
