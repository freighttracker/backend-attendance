const User = require('../models/User');
const SubCompany = require('../models/SubCompany');
const LeaveBalance = require('../models/LeaveBalance');
const LeaveType = require('../models/LeaveType');
const { scopeFilter, canAccessUser } = require('../middleware/scope.middleware');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');
const { workedSince } = require('../utils/employeeStatus');
const { closeOpenItemsOnExit, buildExitSummary } = require('../services/employeeExit.service');

const EXIT_TYPES = ['resigned', 'terminated', 'absconded', 'contract_ended', 'retired', 'other'];
const xlsx = require('xlsx');
const fs = require('fs');

// The Employee create/edit form submits salary data as
// { totalSalary, salaryComponents: [...], customFields: [...] } — this collapses that
// dynamic-fields shape into the User schema's flat `salary` array + `baseSalary`,
// so no fixed field names are required here either.
function normalizeSalaryPayload(body) {
    const { totalSalary, salaryComponents, customFields, ...rest } = body;
    const merged = [...(salaryComponents || []), ...(customFields || [])];
    if (merged.length) rest.salary = merged;
    if (totalSalary !== undefined) rest.baseSalary = totalSalary;
    return rest;
}

// @desc    Get all employees
// @route   GET /api/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
    try {
        const { page = 1, limit = 10, search, department, role, isActive, activeFrom, exitType } = req.query;
        // req.scope is set by attachScope from the caller's OWN user record -
        // a company_admin/subcompany_admin can never see past it regardless
        // of what's in the query string.
        const query = { ...scopeFilter(req) };

        if (search) {
            query.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { employeeCode: { $regex: search, $options: 'i' } }
            ];
        }
        if (department) query.department = department;
        if (role) query.role = role;
        // activeFrom (YYYY-MM-DD) is for month-based screens: current employees
        // plus anyone who left on/after that date, so a leaver still shows for
        // the months they worked. An unparseable date falls back to active-only.
        const activeFromDate = activeFrom ? new Date(activeFrom) : null;
        if (activeFromDate && !Number.isNaN(activeFromDate.getTime())) {
            Object.assign(query, workedSince(activeFromDate));
        } else if (activeFrom) {
            query.isActive = true;
        } else if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }
        if (exitType) {
            if (!EXIT_TYPES.includes(exitType)) {
                return errorResponse(res, `exitType must be one of: ${EXIT_TYPES.join(', ')}`, 400);
            }
            query.isActive = false;
            query.exitType = exitType;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await User.countDocuments(query);

        // Exit records read newest-exit first; everything else newest-hire first.
        const sort = query.isActive === false ? { leftAt: -1, createdAt: -1 } : { createdAt: -1 };
        const users = await User.find(query)
            .select('-password -refreshToken')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, users, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get users error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private
exports.getUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -refreshToken');
        if (!user) {
            return errorResponse(res, 'User not found', 404);
        }
        // Always allowed to view your own record; otherwise must be in scope.
        if (req.user.id !== String(user._id) && req.scope && !canAccessUser(req, user)) {
            return errorResponse(res, 'Not authorized', 403);
        }
        return successResponse(res, user, 'User retrieved successfully');
    } catch (error) {
        logger.error('Get user error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create employee
// @route   POST /api/users
// @access  Private/Admin
exports.createUser = async (req, res) => {
    try {
        const userData = normalizeSalaryPayload(req.body);

        // A company_admin/subcompany_admin can only ever create a user inside
        // their own scope, no matter what company/subCompany was submitted.
        if (req.scope && !req.scope.isSuperAdmin) {
            if (!req.scope.companyId) return errorResponse(res, 'You are not assigned to a company', 403);
            userData.company = req.scope.companyId;
            userData.subCompany = req.scope.subCompanyId || userData.subCompany || null;
            if (userData.subCompany) {
                const belongs = await SubCompany.exists({ _id: userData.subCompany, company: req.scope.companyId });
                if (!belongs) return errorResponse(res, 'That subcompany does not belong to your company', 400);
            }
        }

        const existingUser = await User.findOne({
            $or: [{ email: userData.email }, { employeeCode: userData.employeeCode }]
        });

        if (existingUser) {
            return errorResponse(res, 'User with this email or employee code already exists', 409);
        }

        const user = await User.create(userData);

        // Initialize leave balances for the new user
        const leaveTypes = await LeaveType.find({ isActive: true });
        const currentYear = new Date().getFullYear();

        for (const leaveType of leaveTypes) {
            await LeaveBalance.create({
                user: user._id,
                leaveType: leaveType._id,
                year: currentYear,
                totalDays: leaveType.defaultDaysPerYear,
                usedDays: 0,
                pendingDays: 0,
                carryForwardDays: 0
            });
        }

        logger.info(`User created: ${user.email} by ${req.user.email}`);
        return successResponse(res, user, 'Employee created successfully', 201);
    } catch (error) {
        logger.error('Create user error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update employee
// @route   PUT /api/users/:id
// @access  Private/Admin
exports.updateUser = async (req, res) => {
    try {
        const existing = await User.findById(req.params.id);
        if (!existing) {
            return errorResponse(res, 'User not found', 404);
        }
        if (req.scope && !req.scope.isSuperAdmin && !canAccessUser(req, existing)) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const updates = normalizeSalaryPayload(req.body);
        delete updates.password; // Don't update password through this route
        delete updates.refreshToken;

        // A scoped admin can never move a user OUT of their own company/
        // subcompany by editing these fields, and can't grant themselves a
        // wider scope than their own.
        if (req.scope && !req.scope.isSuperAdmin) {
            delete updates.company;
            delete updates.subCompany;
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true }
        ).select('-password -refreshToken');

        logger.info(`User updated: ${user.email} by ${req.user.email}`);
        return successResponse(res, user, 'Employee updated successfully');
    } catch (error) {
        logger.error('Update user error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Delete employee (soft delete)
// @route   DELETE /api/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
    try {
        const existing = await User.findById(req.params.id);
        if (!existing) {
            return errorResponse(res, 'User not found', 404);
        }
        if (req.scope && !req.scope.isSuperAdmin && !canAccessUser(req, existing)) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isActive: false, leftAt: existing.leftAt || new Date() },
            { new: true }
        );

        logger.info(`User deactivated: ${user.email} by ${req.user.email}`);
        return successResponse(res, null, 'Employee deactivated successfully');
    } catch (error) {
        logger.error('Delete user error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Mark an employee as left (deactivate, keeping all their records)
// @route   PUT /api/users/:id/left
// @access  Private/Admin
exports.markUserLeft = async (req, res) => {
    try {
        const existing = await User.findById(req.params.id);
        if (!existing) {
            return errorResponse(res, 'User not found', 404);
        }
        if (req.scope && !req.scope.isSuperAdmin && !canAccessUser(req, existing)) {
            return errorResponse(res, 'Not authorized', 403);
        }
        if (String(existing._id) === req.user.id) {
            return errorResponse(res, 'You cannot mark yourself as left', 400);
        }

        const { leavingDate, reason, exitType } = req.body;
        if (exitType && !EXIT_TYPES.includes(exitType)) {
            return errorResponse(res, `exitType must be one of: ${EXIT_TYPES.join(', ')}`, 400);
        }
        const leftAt = leavingDate ? new Date(leavingDate) : new Date();
        if (Number.isNaN(leftAt.getTime())) {
            return errorResponse(res, 'Leaving date is not a valid date', 400);
        }
        // The account is deactivated immediately, so a future last working
        // day would lock the employee out early. A day of slack covers the
        // admin's timezone being ahead of the server's.
        if (leftAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
            return errorResponse(res, 'Leaving date cannot be in the future', 400);
        }
        if (existing.joiningDate && leftAt < existing.joiningDate) {
            return errorResponse(res, 'Leaving date cannot be before the joining date', 400);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                isActive: false,
                leftAt,
                leftReason: reason ? String(reason).trim() : null,
                exitType: exitType || null,
                leftMarkedBy: req.user.id
            },
            { new: true }
        ).select('-password -refreshToken');

        // Pending leave is cancelled and the login session ended; every
        // past record (attendance, leave, salary) is kept as-is.
        const cleanup = await closeOpenItemsOnExit(user, leftAt);

        logger.info(`User marked as left: ${user.email} by ${req.user.email}`);
        return successResponse(res, { ...user.toObject(), cleanup }, 'Employee marked as left');
    } catch (error) {
        logger.error('Mark user left error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Exit / full-and-final summary for one employee: dues to recover,
//          amounts still payable, open requests and final-month pay status.
//          Works before exit too (as a preview of what marking left will do).
// @route   GET /api/users/:id/exit-summary
// @access  Private/Admin
exports.getExitSummary = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return errorResponse(res, 'User not found', 404);
        }
        if (req.scope && !req.scope.isSuperAdmin && !canAccessUser(req, user)) {
            return errorResponse(res, 'Not authorized', 403);
        }

        let previewDate = null;
        if (req.query.leavingDate) {
            previewDate = new Date(req.query.leavingDate);
            if (Number.isNaN(previewDate.getTime())) {
                return errorResponse(res, 'Leaving date is not a valid date', 400);
            }
        }

        const summary = await buildExitSummary(user, previewDate);
        return successResponse(res, summary, 'Exit summary retrieved');
    } catch (error) {
        logger.error('Get exit summary error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Bring back an employee who had left
// @route   PUT /api/users/:id/rejoin
// @access  Private/Admin
exports.rejoinUser = async (req, res) => {
    try {
        const existing = await User.findById(req.params.id);
        if (!existing) {
            return errorResponse(res, 'User not found', 404);
        }
        if (req.scope && !req.scope.isSuperAdmin && !canAccessUser(req, existing)) {
            return errorResponse(res, 'Not authorized', 403);
        }

        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isActive: true, leftAt: null, leftReason: null, exitType: null, leftMarkedBy: null },
            { new: true }
        ).select('-password -refreshToken');

        logger.info(`User rejoined: ${user.email} by ${req.user.email}`);
        return successResponse(res, user, 'Employee is active again');
    } catch (error) {
        logger.error('Rejoin user error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get employee profile (for employee)
// @route   GET /api/users/profile/me
// @access  Private
exports.getMyProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -refreshToken');
        return successResponse(res, user, 'Profile retrieved successfully');
    } catch (error) {
        logger.error('Get profile error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update employee profile
// @route   PUT /api/users/profile/me
// @access  Private
exports.updateMyProfile = async (req, res) => {
    try {
        const allowedUpdates = ['phone', 'address', 'emergencyContact', 'avatarUrl'];
        const updates = {};

        allowedUpdates.forEach(field => {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        });

        const user = await User.findByIdAndUpdate(
            req.user.id,
            updates,
            { new: true, runValidators: true }
        ).select('-password -refreshToken');

        return successResponse(res, user, 'Profile updated successfully');
    } catch (error) {
        logger.error('Update profile error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Upload avatar
// @route   POST /api/users/avatar
// @access  Private
exports.uploadAvatar = async (req, res) => {
    try {
        if (!req.file) {
            return errorResponse(res, 'Please upload an image', 400);
        }

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { avatarUrl },
            { new: true }
        ).select('-password -refreshToken');

        return successResponse(res, { avatarUrl }, 'Avatar uploaded successfully');
    } catch (error) {
        logger.error('Upload avatar error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Bulk upload employees via Excel
// @route   POST /api/users/bulk-upload
// @access  Private/Admin
exports.bulkUpload = async (req, res) => {
    try {
        if (!req.file) {
            return errorResponse(res, 'Please upload an Excel file', 400);
        }

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        const results = { success: [], failed: [] };
        const leaveTypes = await LeaveType.find({ isActive: true });
        const currentYear = new Date().getFullYear();

        for (const row of data) {
            try {
                const userData = {
                    employeeCode: row.EmployeeCode || row['Employee Code'],
                    email: row.Email,
                    password: row.Password || 'employee123',
                    firstName: row.FirstName || row['First Name'],
                    lastName: row.LastName || row['Last Name'],
                    phone: row.Phone || row['Phone Number'],
                    department: row.Department,
                    designation: row.Designation,
                    joiningDate: row.JoiningDate || row['Joining Date'],
                    baseSalary: row.BaseSalary || row['Base Salary'] || 0,
                    role: 'employee'
                };

                const existingUser = await User.findOne({
                    $or: [{ email: userData.email }, { employeeCode: userData.employeeCode }]
                });

                if (existingUser) {
                    results.failed.push({
                        employeeCode: userData.employeeCode,
                        reason: 'Already exists'
                    });
                    continue;
                }

                const user = await User.create(userData);

                // Initialize leave balances
                for (const leaveType of leaveTypes) {
                    await LeaveBalance.create({
                        user: user._id,
                        leaveType: leaveType._id,
                        year: currentYear,
                        totalDays: leaveType.defaultDaysPerYear,
                        usedDays: 0,
                        pendingDays: 0,
                        carryForwardDays: 0
                    });
                }

                results.success.push(userData.employeeCode);
            } catch (err) {
                results.failed.push({
                    employeeCode: row.EmployeeCode || row['Employee Code'],
                    reason: err.message
                });
            }
        }

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        logger.info(`Bulk upload completed. Success: ${results.success.length}, Failed: ${results.failed.length}`);
        return successResponse(res, results, 'Bulk upload completed');
    } catch (error) {
        logger.error('Bulk upload error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get departments list
// @route   GET /api/users/departments/list
// @access  Private
exports.getDepartments = async (req, res) => {
    try {
        // Scoped so one company never sees another company's department names.
        const departments = await User.distinct('department', { ...scopeFilter(req), department: { $nin: [null, ''] } });
        return successResponse(res, departments, 'Departments retrieved');
    } catch (error) {
        logger.error('Get departments error:', error);
        return errorResponse(res, error.message, 500);
    }
};
