const express = require('express');
const router = express.Router();
const payrollController = require('../controllers/payroll.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.use(authenticate, authorize('admin'));

router.get('/dashboard', payrollController.getPayrollDashboard);

router.post('/generate', payrollController.generatePayroll);
router.post('/generate/employee', payrollController.generateSingleEmployeeSalary);
router.post('/generate/department', payrollController.generateDepartmentSalary);
router.post('/generate/company', payrollController.generateCompanySalary);

router.get('/reports', payrollController.getPayrollReport);
router.get('/reports/export', payrollController.exportPayrollReport);

router.get('/settings', payrollController.getPayrollSettings);
router.put('/settings', payrollController.updatePayrollSettings);

router.get('/runs', payrollController.getPayrollRuns);
router.get('/runs/:id', payrollController.getPayrollRun);
router.put('/runs/:id/approve', payrollController.approvePayrollRun);
router.put('/runs/:id/reject', payrollController.rejectPayrollRun);
router.put('/runs/:id/publish', payrollController.publishPayrollRun);
router.put('/runs/:id/lock', payrollController.lockPayrollRun);
router.put('/runs/:id/unlock', payrollController.unlockPayrollRun);

module.exports = router;
