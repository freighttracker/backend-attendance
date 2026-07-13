const express = require('express');
const router = express.Router();
const salaryController = require('../controllers/salary.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Employee routes
router.get('/my-slips', authenticate, salaryController.getMySalarySlips);
router.get('/:id', authenticate, salaryController.getSalarySlip);

// Admin routes
router.get('/all', authenticate, authorize('admin'), salaryController.getAllSalarySlips);
router.post('/generate', authenticate, authorize('admin'), salaryController.generateSalarySlip);
router.post('/generate-all', authenticate, authorize('admin'), salaryController.generateAllSalarySlips);
router.put('/:id/approve', authenticate, authorize('admin'), salaryController.approveSalarySlip);
router.put('/:id/pay', authenticate, authorize('admin'), salaryController.markAsPaid);

module.exports = router;
