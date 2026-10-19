const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');

// Every admin tier reaches the admin panel; attachScope keeps company and
// subcompany admins to their own staff.
const anyAdmin = authorize('superadmin', 'admin', 'company_admin', 'subcompany_admin');
router.get('/admin', authenticate, anyAdmin, attachScope, dashboardController.getAdminDashboard);
router.get('/employee', authenticate, dashboardController.getEmployeeDashboard);

module.exports = router;
