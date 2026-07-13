const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/attendance', authenticate, authorize('admin'), reportController.getAttendanceReport);
router.get('/leaves', authenticate, authorize('admin'), reportController.getLeaveReport);
router.get('/salary', authenticate, authorize('admin'), reportController.getSalaryReport);
router.get('/monthly-summary', authenticate, authorize('admin'), reportController.getMonthlySummary);
router.get('/late-comers', authenticate, authorize('admin'), reportController.getLateComersReport);

module.exports = router;
