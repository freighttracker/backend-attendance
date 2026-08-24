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
        entityType: 'Company',
        entityId,
        oldValues,
        newValues,
        ipAddress: req.ip
    }).catch((err) => logger.error('Audit log write failed:', err));
};

// @desc    List companies (with subcompany + user counts)
// @route   GET /api/companies
// @access  Private/SuperAdmin
exports.listCompanies = async (req, res) => {
    try {
        const { page = 1, limit = 50, search, isActive } = req.query;
        const query = {};
        if (search) {
            const re = new RegExp(search.trim(), 'i');
            query.$or = [{ name: re }, { code: re }, { email: re }];
        }
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Company.countDocuments(query);
        const companies = await Company.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));

        const companyIds = companies.map((c) => c._id);
        const [subCompanyCounts, userCounts] = await Promise.all([
            SubCompany.aggregate([
                { $match: { company: { $in: companyIds } } },
                { $group: { _id: '$company', count: { $sum: 1 } } }
            ]),
            User.aggregate([
                { $match: { company: { $in: companyIds } } },
                { $group: { _id: '$company', count: { $sum: 1 } } }
            ])
        ]);
        const subCountMap = new Map(subCompanyCounts.map((c) => [String(c._id), c.count]));
        const userCountMap = new Map(userCounts.map((c) => [String(c._id), c.count]));

        const items = companies.map((c) => ({
            ...c.toObject(),
            subCompanyCount: subCountMap.get(String(c._id)) || 0,
            userCount: userCountMap.get(String(c._id)) || 0
        }));

        return paginatedResponse(res, items, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.max(Math.ceil(total / parseInt(limit)), 1)
        });
    } catch (error) {
        logger.error('List companies error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get a single company (with its subcompanies)
// @route   GET /api/companies/:id
// @access  Private/SuperAdmin
exports.getCompany = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) return errorResponse(res, 'Company not found', 404);

        const subCompanies = await SubCompany.find({ company: company._id }).sort({ name: 1 });
        return successResponse(res, { ...company.toObject(), subCompanies }, 'Company retrieved');
    } catch (error) {
        logger.error('Get company error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create a company
// @route   POST /api/companies
// @access  Private/SuperAdmin
exports.createCompany = async (req, res) => {
    try {
        const { name, code, email, phone, address, city, state, country, taxNumber, website, contactPerson } = req.body;
        if (!name || !code) return errorResponse(res, 'Company name and code are required', 400);

        const existing = await Company.findOne({ code: code.trim().toUpperCase() });
        if (existing) return errorResponse(res, 'A company with this code already exists', 409);

        const company = await Company.create({
            name, code, email, phone, address, city, state, country, taxNumber, website, contactPerson,
            createdBy: req.user.id,
            updatedBy: req.user.id
        });

        logAudit(req, 'create', company._id, null, company.toObject());
        logger.info(`Company created: ${company.code} by ${req.user.email}`);
        return successResponse(res, company, 'Company created successfully', 201);
    } catch (error) {
        logger.error('Create company error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update a company
// @route   PUT /api/companies/:id
// @access  Private/SuperAdmin
exports.updateCompany = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) return errorResponse(res, 'Company not found', 404);

        const before = company.toObject();
        const { name, email, phone, address, city, state, country, taxNumber, website, contactPerson } = req.body;
        if (name !== undefined) company.name = name;
        if (email !== undefined) company.email = email;
        if (phone !== undefined) company.phone = phone;
        if (address !== undefined) company.address = address;
        if (city !== undefined) company.city = city;
        if (state !== undefined) company.state = state;
        if (country !== undefined) company.country = country;
        if (taxNumber !== undefined) company.taxNumber = taxNumber;
        if (website !== undefined) company.website = website;
        if (contactPerson !== undefined) company.contactPerson = contactPerson;
        company.updatedBy = req.user.id;

        await company.save();

        logAudit(req, 'update', company._id, before, company.toObject());
        logger.info(`Company updated: ${company.code} by ${req.user.email}`);
        return successResponse(res, company, 'Company updated successfully');
    } catch (error) {
        logger.error('Update company error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Activate/deactivate a company (cascades to its subcompanies)
// @route   PUT /api/companies/:id/status
// @access  Private/SuperAdmin
exports.setCompanyStatus = async (req, res) => {
    try {
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') return errorResponse(res, 'isActive (boolean) is required', 400);

        const company = await Company.findById(req.params.id);
        if (!company) return errorResponse(res, 'Company not found', 404);

        const before = company.toObject();
        company.isActive = isActive;
        company.updatedBy = req.user.id;
        await company.save();

        // Deactivating a company deactivates its subcompanies too, so access
        // can't be regained through a still-active subcompany underneath it.
        // Reactivating the company does NOT auto-reactivate subcompanies -
        // an admin explicitly re-enables whichever ones should come back.
        if (!isActive) {
            await SubCompany.updateMany({ company: company._id, isActive: true }, { isActive: false, updatedBy: req.user.id });
        }

        logAudit(req, isActive ? 'activate' : 'deactivate', company._id, before, company.toObject());
        logger.info(`Company ${isActive ? 'activated' : 'deactivated'}: ${company.code} by ${req.user.email}`);
        return successResponse(res, company, `Company ${isActive ? 'activated' : 'deactivated'}`);
    } catch (error) {
        logger.error('Set company status error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Archive (soft-delete) a company - only if it has no users left in it
// @route   DELETE /api/companies/:id
// @access  Private/SuperAdmin
exports.archiveCompany = async (req, res) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) return errorResponse(res, 'Company not found', 404);

        const userCount = await User.countDocuments({ company: company._id });
        if (userCount > 0) {
            return errorResponse(res, `Cannot delete a company with ${userCount} user(s) still assigned to it. Reassign or deactivate them first.`, 400);
        }

        const before = company.toObject();
        company.isActive = false;
        company.updatedBy = req.user.id;
        await company.save();
        await SubCompany.updateMany({ company: company._id }, { isActive: false, updatedBy: req.user.id });

        logAudit(req, 'archive', company._id, before, company.toObject());
        logger.info(`Company archived: ${company.code} by ${req.user.email}`);
        return successResponse(res, null, 'Company archived successfully');
    } catch (error) {
        logger.error('Archive company error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    List users belonging to a company (any of its subcompanies included)
// @route   GET /api/companies/:id/users
// @access  Private/SuperAdmin or that company's own Company Admin
exports.getCompanyUsers = async (req, res) => {
    try {
        if (!req.scope.isSuperAdmin && String(req.scope.companyId || '') !== String(req.params.id)) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const { page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = { company: req.params.id };
        const total = await User.countDocuments(query);
        const users = await User.find(query)
            .select('-password -refreshToken')
            .populate('subCompany', 'name code')
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
        logger.error('Get company users error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    System-wide hierarchy stats for the Super Admin dashboard
// @route   GET /api/companies/stats
// @access  Private/SuperAdmin
exports.getCompanyStats = async (req, res) => {
    try {
        const [totalCompanies, activeCompanies, totalSubCompanies, activeSubCompanies, totalUsers, recentCompanies, recentSubCompanies] = await Promise.all([
            Company.countDocuments({}),
            Company.countDocuments({ isActive: true }),
            SubCompany.countDocuments({}),
            SubCompany.countDocuments({ isActive: true }),
            User.countDocuments({ company: { $ne: null } }),
            Company.find({}).sort({ createdAt: -1 }).limit(5),
            SubCompany.find({}).sort({ createdAt: -1 }).limit(5).populate('company', 'name code')
        ]);

        return successResponse(res, {
            totalCompanies,
            activeCompanies,
            inactiveCompanies: totalCompanies - activeCompanies,
            totalSubCompanies,
            activeSubCompanies,
            inactiveSubCompanies: totalSubCompanies - activeSubCompanies,
            totalUsers,
            recentCompanies,
            recentSubCompanies
        }, 'Company hierarchy stats retrieved');
    } catch (error) {
        logger.error('Get company stats error:', error);
        return errorResponse(res, error.message, 500);
    }
};
