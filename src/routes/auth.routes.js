const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');


// Register (Admin only)
router.post('/register', [
    body('employeeCode').notEmpty().withMessage('Employee code is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required')
], validate, authController.register);

// Login
router.post('/login', [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required')
], validate, authController.login);

// router.post('/login', validate([
//     body('email').isEmail().withMessage('Valid email is required'),
//     body('password').notEmpty().withMessage('Password is required')
// ]), authController.login);


// Refresh token
router.post('/refresh', authController.refreshToken);

// Get current user
router.get('/me', authenticate, authController.getMe);

// Update password
router.put('/password', authenticate, [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], validate, authController.updatePassword);

// Logout
router.post('/logout', authenticate, authController.logout);

module.exports = router;
