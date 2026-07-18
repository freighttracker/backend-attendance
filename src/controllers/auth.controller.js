const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// Generate JWT Token
const generateToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '7d'
    });
};

const generateRefreshToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d'
    });
};

// @desc    Register new user (Admin only)
// @route   POST /api/auth/register
// @access  Private/Admin
exports.register = async (req, res) => {
    try {
        const {
            employeeCode, email, password, firstName, lastName,
            phone, department, designation, joiningDate, role,
            baseSalary, dateOfBirth, gender, address, bankDetails,
            panNumber, emergencyContact
        } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ email }, { employeeCode }]
        });

        if (existingUser) {
            return errorResponse(res, 'User with this email or employee code already exists', 409);
        }

        const user = await User.create({
            employeeCode,
            email,
            password,
            firstName,
            lastName,
            phone,
            department,
            designation,
            joiningDate,
            role: role || 'employee',
            baseSalary: baseSalary || 0,
            dateOfBirth,
            gender,
            address,
            bankDetails,
            panNumber,
            emergencyContact
        });

        logger.info(`New user registered: ${user.email}`);

        return successResponse(res, {
            id: user._id,
            employeeCode: user.employeeCode,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role
        }, 'User registered successfully', 201);
    } catch (error) {
        logger.error('Registration error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return errorResponse(res, 'Please provide email and password', 400);
        }

        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            return errorResponse(res, 'Invalid credentials', 401);
        }

        if (!user.isActive) {
            return errorResponse(res, 'Your account has been deactivated. Please contact admin.', 403);
        }

        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            await user.incLoginAttempts();
            return errorResponse(res, 'Invalid credentials', 401);
        }

        // Reset login attempts on successful login
        if (user.loginAttempts > 0) {
            await User.updateOne(
                { _id: user._id },
                { $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } }
            );
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        const token = generateToken(user._id);
        const refreshToken = generateRefreshToken(user._id);

        // Save refresh token
        await User.findByIdAndUpdate(user._id, { refreshToken });

        logger.info(`User logged in: ${user.email}`);

        return successResponse(res, {
            token,
            refreshToken,
            user: {
                id: user._id,
                employeeCode: user.employeeCode,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                fullName: user.fullName,
                role: user.role,
                department: user.department,
                designation: user.designation,
                avatarUrl: user.avatarUrl
            }
        }, 'Login successful');
    } catch (error) {
        logger.error('Login error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Refresh token
// @route   POST /api/auth/refresh
// @access  Public
exports.refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return errorResponse(res, 'Refresh token is required', 400);
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user || user.refreshToken !== refreshToken) {
            return errorResponse(res, 'Invalid refresh token', 401);
        }

        const newToken = generateToken(user._id);
        const newRefreshToken = generateRefreshToken(user._id);

        await User.findByIdAndUpdate(user._id, { refreshToken: newRefreshToken });

        return successResponse(res, {
            token: newToken,
            refreshToken: newRefreshToken
        }, 'Token refreshed successfully');
    } catch (error) {
        logger.error('Refresh token error:', error);
        return errorResponse(res, 'Invalid refresh token', 401);
    }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .populate('department', 'name')
            .select('-password -refreshToken');

        return successResponse(res, user, 'Profile retrieved successfully');
    } catch (error) {
        logger.error('Get profile error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Update password
// @route   PUT /api/auth/password
// @access  Private
exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const user = await User.findById(req.user.id).select('+password');

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return errorResponse(res, 'Current password is incorrect', 400);
        }

        user.password = newPassword;
        await user.save();

        return successResponse(res, null, 'Password updated successfully');
    } catch (error) {
        logger.error('Update password error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
exports.logout = async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user.id, { $unset: { refreshToken: 1 } });
        return successResponse(res, null, 'Logged out successfully');
    } catch (error) {
        logger.error('Logout error:', error);
        return errorResponse(res, error.message, 500);
    }
};
