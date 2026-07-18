const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/admin', authenticate, authorize('admin'), dashboardController.getAdminDashboard);
router.get('/employee', authenticate, dashboardController.getEmployeeDashboard);

module.exports = router;
