const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const leaveController = require('../controllers/leave.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const upload = require('../middleware/upload.middleware');

// Employee routes
router.post(
    '/apply',
    authenticate,
    upload.single('medicalCertificate'),
    [
        body('leaveTypeId').notEmpty().withMessage('Leave type is required'),
        body('startDate').notEmpty().withMessage('Start date is required'),
        body('endDate').notEmpty().withMessage('End date is required'),
        body('reason').notEmpty().withMessage('Reason is required')
    ],
    validate,
    leaveController.applyLeave
);
router.get('/my-leaves', authenticate, leaveController.getMyLeaves);
router.get('/balance', authenticate, leaveController.getLeaveBalance);
router.put('/:id/cancel', authenticate, leaveController.cancelLeave);

// Admin routes
router.get('/all', authenticate, authorize('admin'), leaveController.getAllLeaves);
router.get('/stats', authenticate, authorize('admin'), leaveController.getLeaveStats);
router.post(
    '/balances',
    authenticate,
    authorize('admin'),
    [
        body('userId').notEmpty().withMessage('Employee is required'),
        body('leaveTypeId').notEmpty().withMessage('Leave type is required'),
        body('year').isInt().withMessage('Valid year is required')
    ],
    validate,
    leaveController.adjustLeaveBalance
);
router.put(
    '/:id/status',
    authenticate,
    authorize('admin'),
    [
        body('status').isIn(['approved', 'rejected']).withMessage('Status must be approved or rejected'),
        body('paidStatus')
            .if(body('status').equals('approved'))
            .isIn(['paid', 'unpaid', 'partial'])
            .withMessage('paidStatus (paid|unpaid|partial) is required when approving'),
        body('paidDays')
            .if(body('paidStatus').equals('partial'))
            .isFloat({ min: 0 })
            .withMessage('paidDays must be a non-negative number for a partial approval'),
        body('unpaidDays')
            .if(body('paidStatus').equals('partial'))
            .isFloat({ min: 0 })
            .withMessage('unpaidDays must be a non-negative number for a partial approval')
    ],
    validate,
    leaveController.updateLeaveStatus
);
router.put('/:id', authenticate, authorize('admin'), leaveController.updateLeaveRequest);

// Leave types
router.get('/types', authenticate, leaveController.getLeaveTypes);
router.post('/types', authenticate, authorize('admin'), leaveController.createLeaveType);
router.put('/types/:id', authenticate, authorize('admin'), leaveController.updateLeaveType);
router.delete('/types/:id', authenticate, authorize('admin'), leaveController.deleteLeaveType);

module.exports = router;
