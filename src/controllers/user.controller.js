const User = require('../models/User');
const LeaveBalance = require('../models/LeaveBalance');
const LeaveType = require('../models/LeaveType');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');
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
        const { page = 1, limit = 10, search, department, role, isActive } = req.query;
        const query = {};

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
        if (isActive !== undefined) query.isActive = isActive === 'true';

        const skip = (parseInt(page) - 1) * parseInt(limit);
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
        const updates = normalizeSalaryPayload(req.body);
        delete updates.password; // Don't update password through this route
        delete updates.refreshToken;

        const user = await User.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true, runValidators: true }
        ).select('-password -refreshToken');

        if (!user) {
            return errorResponse(res, 'User not found', 404);
        }

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
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!user) {
            return errorResponse(res, 'User not found', 404);
        }

        logger.info(`User deactivated: ${user.email} by ${req.user.email}`);
        return successResponse(res, null, 'Employee deactivated successfully');
    } catch (error) {
        logger.error('Delete user error:', error);
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
        const departments = await User.distinct('department', { department: { $ne: null } });
        return successResponse(res, departments, 'Departments retrieved');
    } catch (error) {
        logger.error('Get departments error:', error);
        return errorResponse(res, error.message, 500);
    }
};
