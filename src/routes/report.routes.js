const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/attendance', authenticate, authorize('superadmin', 'admin'), reportController.getAttendanceReport);
router.get('/leaves', authenticate, authorize('superadmin', 'admin'), reportController.getLeaveReport);
router.get('/salary', authenticate, authorize('superadmin', 'admin'), reportController.getSalaryReport);
router.get('/monthly-summary', authenticate, authorize('superadmin', 'admin'), reportController.getMonthlySummary);
router.get('/late-comers', authenticate, authorize('superadmin', 'admin'), reportController.getLateComersReport);

module.exports = router;
