const mongoose = require('mongoose');

// Narrows what one admin may do in the location-attendance module. Without a
// document an admin gets their role's defaults (see geoAccess.service.js);
// with one, only the flags and offices granted here apply.
const officeAdminPermissionSchema = new mongoose.Schema({
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        default: null
    },
    // Empty = every office in the admin's company/subcompany scope.
    offices: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OfficeLocation'
    }],
    canManageOffices: {
        type: Boolean,
        default: false
    },
    canManageAssignments: {
        type: Boolean,
        default: false
    },
    canViewLocations: {
        type: Boolean,
        default: false
    },
    canReviewExceptions: {
        type: Boolean,
        default: false
    },
    grantedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

officeAdminPermissionSchema.index({ admin: 1 }, { unique: true });
officeAdminPermissionSchema.index({ company: 1 });

module.exports = mongoose.model('OfficeAdminPermission', officeAdminPermissionSchema);
