const Company = require('../models/Company');
const SubCompany = require('../models/SubCompany');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

const logAudit = (req, action, entityId, oldValues, newValues) => {
    AuditLog.create({
        user: req.user.id,
        action,
        entityType: 'SubCompany',
        entityId,
        oldValues,
        newValues,
        ipAddress: req.ip
    }).catch((err) => logger.error('Audit log write failed:', err));
};

// A company_admin may only manage subcompanies under their own company, even
// if they somehow pass a different companyId - this is the actual
// enforcement point (req.scope.companyId comes from their own user record,
// never the request).
const assertCompanyInScope = (req, companyId) => {
    if (req.scope.isSuperAdmin) return true;
    return req.scope.companyId && String(req.scope.companyId) === String(companyId);
};

// @desc    List subcompanies (optionally filtered to one company)
// @route   GET /api/subcompanies
// @access  Private/SuperAdmin or Company Admin (own company only)
exports.listSubCompanies = async (req, res) => {
    try {
        const { page = 1, limit = 50, search, isActive, companyId } = req.query;
        const query = {};

        if (req.scope.isSuperAdmin) {
            if (companyId) query.company = companyId;
        } else if (req.scope.companyId) {
            // Non-superadmin: always their own company, regardless of what
            // (if anything) was requested.
            query.company = req.scope.companyId;
        } else {
            // No company assigned at all - nothing to show.
            return paginatedResponse(res, [], { page: 1, limit: parseInt(limit), total: 0, totalPages: 1 });
        }

        if (search) {
            const re = new RegExp(search.trim(), 'i');
            query.$or = [{ name: re }, { code: re }, { email: re }];
        }
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await SubCompany.countDocuments(query);
        const subCompanies = await SubCompany.find(query)
            .populate('company', 'name code')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const subCompanyIds = subCompanies.map((s) => s._id);
        const userCounts = await User.aggregate([
            { $match: { subCompany: { $in: subCompanyIds } } },
            { $group: { _id: '$subCompany', count: { $sum: 1 } } }
        ]);
        const userCountMap = new Map(userCounts.map((c) => [String(c._id), c.count]));

        const items = subCompanies.map((s) => ({ ...s.toObject(), userCount: userCountMap.get(String(s._id)) || 0 }));

        return paginatedResponse(res, items, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.max(Math.ceil(total / parseInt(limit)), 1)
        });
    } catch (error) {
        logger.error('List subcompanies error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get a single subcompany
// @route   GET /api/subcompanies/:id
// @access  Private/SuperAdmin or that subcompany's own Company/Subcompany Admin
exports.getSubCompany = async (req, res) => {
    try {
        const subCompany = await SubCompany.findById(req.params.id).populate('company', 'name code');
        if (!subCompany) return errorResponse(res, 'Subcompany not found', 404);
        if (!assertCompanyInScope(req, subCompany.company._id) && !(req.scope.subCompanyId && String(req.scope.subCompanyId) === String(subCompany._id))) {
            return errorResponse(res, 'Not authorized', 403);
        }
        return successResponse(res, subCompany, 'Subcompany retrieved');
    } catch (error) {
        logger.error('Get subcompany error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create a subcompany under a company
// @route   POST /api/subcompanies
// @access  Private/SuperAdmin or that company's own Company Admin
exports.createSubCompany = async (req, res) => {
    try {
        const { company: companyId, name, code, email, phone, address, city, state, country, taxNumber, website, contactPerson } = req.body;
        if (!companyId || !name || !code) {
            return errorResponse(res, 'Company, subcompany name and code are required', 400);
        }
        if (!assertCompanyInScope(req, companyId)) {
            return errorResponse(res, 'Not authorized to create a subcompany under that company', 403);
        }

        const company = await Company.findById(companyId);
        if (!company) return errorResponse(res, 'Company not found', 404);

        const existing = await SubCompany.findOne({ company: companyId, code: code.trim().toUpperCase() });
        if (existing) return errorResponse(res, 'A subcompany with this code already exists under this company', 409);

        const subCompany = await SubCompany.create({
            company: companyId, name, code, email, phone, address, city, state, country, taxNumber, website, contactPerson,
            createdBy: req.user.id,
            updatedBy: req.user.id
        });

        logAudit(req, 'create', subCompany._id, null, subCompany.toObject());
        logger.info(`Subcompany created: ${subCompany.code} under ${company.code} by ${req.user.email}`);
        return successResponse(res, subCompany, 'Subcompany created successfully', 201);
    } catch (error) {
        logger.error('Create subcompany error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update a subcompany
// @route   PUT /api/subcompanies/:id
// @access  Private/SuperAdmin or that company's own Company Admin
exports.updateSubCompany = async (req, res) => {
    try {
        const subCompany = await SubCompany.findById(req.params.id);
        if (!subCompany) return errorResponse(res, 'Subcompany not found', 404);
        if (!assertCompanyInScope(req, subCompany.company)) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const before = subCompany.toObject();
        const { name, email, phone, address, city, state, country, taxNumber, website, contactPerson } = req.body;
        if (name !== undefined) subCompany.name = name;
        if (email !== undefined) subCompany.email = email;
        if (phone !== undefined) subCompany.phone = phone;
        if (address !== undefined) subCompany.address = address;
        if (city !== undefined) subCompany.city = city;
        if (state !== undefined) subCompany.state = state;
        if (country !== undefined) subCompany.country = country;
        if (taxNumber !== undefined) subCompany.taxNumber = taxNumber;
        if (website !== undefined) subCompany.website = website;
        if (contactPerson !== undefined) subCompany.contactPerson = contactPerson;
        subCompany.updatedBy = req.user.id;

        await subCompany.save();

        logAudit(req, 'update', subCompany._id, before, subCompany.toObject());
        logger.info(`Subcompany updated: ${subCompany.code} by ${req.user.email}`);
        return successResponse(res, subCompany, 'Subcompany updated successfully');
    } catch (error) {
        logger.error('Update subcompany error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Activate/deactivate a subcompany
// @route   PUT /api/subcompanies/:id/status
// @access  Private/SuperAdmin or that company's own Company Admin
exports.setSubCompanyStatus = async (req, res) => {
    try {
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') return errorResponse(res, 'isActive (boolean) is required', 400);

        const subCompany = await SubCompany.findById(req.params.id);
        if (!subCompany) return errorResponse(res, 'Subcompany not found', 404);
        if (!assertCompanyInScope(req, subCompany.company)) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const before = subCompany.toObject();
        subCompany.isActive = isActive;
        subCompany.updatedBy = req.user.id;
        await subCompany.save();

        logAudit(req, isActive ? 'activate' : 'deactivate', subCompany._id, before, subCompany.toObject());
        logger.info(`Subcompany ${isActive ? 'activated' : 'deactivated'}: ${subCompany.code} by ${req.user.email}`);
        return successResponse(res, subCompany, `Subcompany ${isActive ? 'activated' : 'deactivated'}`);
    } catch (error) {
        logger.error('Set subcompany status error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Archive (soft-delete) a subcompany - only if it has no users left in it
// @route   DELETE /api/subcompanies/:id
// @access  Private/SuperAdmin or that company's own Company Admin
exports.archiveSubCompany = async (req, res) => {
    try {
        const subCompany = await SubCompany.findById(req.params.id);
        if (!subCompany) return errorResponse(res, 'Subcompany not found', 404);
        if (!assertCompanyInScope(req, subCompany.company)) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const userCount = await User.countDocuments({ subCompany: subCompany._id });
        if (userCount > 0) {
            return errorResponse(res, `Cannot delete a subcompany with ${userCount} user(s) still assigned to it. Reassign or deactivate them first.`, 400);
        }

        const before = subCompany.toObject();
        subCompany.isActive = false;
        subCompany.updatedBy = req.user.id;
        await subCompany.save();

        logAudit(req, 'archive', subCompany._id, before, subCompany.toObject());
        logger.info(`Subcompany archived: ${subCompany.code} by ${req.user.email}`);
        return successResponse(res, null, 'Subcompany archived successfully');
    } catch (error) {
        logger.error('Archive subcompany error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    List users belonging to a subcompany
// @route   GET /api/subcompanies/:id/users
// @access  Private/SuperAdmin or that subcompany's own admins
exports.getSubCompanyUsers = async (req, res) => {
    try {
        const subCompany = await SubCompany.findById(req.params.id);
        if (!subCompany) return errorResponse(res, 'Subcompany not found', 404);
        if (!assertCompanyInScope(req, subCompany.company) && !(req.scope.subCompanyId && String(req.scope.subCompanyId) === String(subCompany._id))) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const { page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const query = { subCompany: subCompany._id };
        const total = await User.countDocuments(query);
        const users = await User.find(query)
            .select('-password -refreshToken')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, users, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.max(Math.ceil(total / parseInt(limit)), 1)
        });
    } catch (error) {
        logger.error('Get subcompany users error:', error);
        return errorResponse(res, error.message, 500);
    }
};
