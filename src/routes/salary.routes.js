const express = require('express');
const router = express.Router();
const salaryController = require('../controllers/salary.controller');
const payrollController = require('../controllers/payroll.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');

// Employee routes
router.get('/my-slips', authenticate, salaryController.getMySalarySlips);

// Alias for POST /api/payroll/generate - kept here since some clients call
// /api/salary/generate instead of the canonical payroll route.
router.post('/generate', authenticate, authorize('superadmin', 'admin'), payrollController.generatePayroll);

// Admin routes
router.get('/all', authenticate, authorize('superadmin', 'admin'), attachScope, salaryController.getAllSalarySlips);
router.post('/:id/regenerate', authenticate, authorize('superadmin', 'admin'), salaryController.regenerateSalarySlip);
router.put('/:id/approve', authenticate, authorize('superadmin', 'admin'), salaryController.approveSalarySlip);
router.put('/:id/reject', authenticate, authorize('superadmin', 'admin'), salaryController.rejectSalarySlip);
router.put('/:id/publish', authenticate, authorize('superadmin', 'admin'), salaryController.publishSalarySlip);
router.put('/:id/lock', authenticate, authorize('superadmin', 'admin'), salaryController.lockSalarySlip);
router.put('/:id/unlock', authenticate, authorize('superadmin', 'admin'), salaryController.unlockSalarySlip);
router.put('/:id/pay', authenticate, authorize('superadmin', 'admin'), salaryController.markAsPaid);
router.post('/:id/email', authenticate, authorize('superadmin', 'admin'), salaryController.emailSalarySlip);

// Shared (self or admin) - keep generic /:id routes last so specific paths above always win
router.get('/:id/download', authenticate, salaryController.downloadSalarySlip);
router.get('/:id', authenticate, salaryController.getSalarySlip);

module.exports = router;
