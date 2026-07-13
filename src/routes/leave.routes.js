const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/leave.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Employee routes
router.post('/apply', authenticate, leaveController.applyLeave);
router.get('/my-leaves', authenticate, leaveController.getMyLeaves);
router.get('/balance', authenticate, leaveController.getLeaveBalance);
router.put('/:id/cancel', authenticate, leaveController.cancelLeave);

// Admin routes
router.get('/all', authenticate, authorize('admin'), leaveController.getAllLeaves);
router.put('/:id/status', authenticate, authorize('admin'), leaveController.updateLeaveStatus);

// Leave types
router.get('/types', authenticate, leaveController.getLeaveTypes);
router.post('/types', authenticate, authorize('admin'), leaveController.createLeaveType);
router.put('/types/:id', authenticate, authorize('admin'), leaveController.updateLeaveType);

module.exports = router;
