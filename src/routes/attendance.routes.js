const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance.controller');
const attendanceReportController = require('../controllers/attendanceReport.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Employee routes
router.post('/check-in', authenticate, attendanceController.checkIn);
router.post('/check-out', authenticate, attendanceController.checkOut);
router.get('/today', authenticate, attendanceController.getTodayAttendance);
router.get('/history', authenticate, attendanceController.getAttendanceHistory);
router.get('/working-hours', authenticate, attendanceController.getWorkingHours);
router.post('/correction', authenticate, attendanceController.requestCorrection);
router.get('/my-corrections', authenticate, attendanceController.getMyCorrectionRequests);
router.get('/monthly-summary', authenticate, attendanceReportController.getMyMonthlySummary);
router.get('/employee/:id', authenticate, attendanceController.getEmployeeAttendance);

// Admin routes
router.get('/all', authenticate, authorize('admin'), attendanceController.getAllAttendance);
router.get('/corrections', authenticate, authorize('admin'), attendanceController.getCorrectionRequests);
router.put('/corrections/:id', authenticate, authorize('admin'), attendanceController.handleCorrectionRequest);
router.post('/lock', authenticate, authorize('admin'), attendanceController.lockAttendance);
router.get('/report', authenticate, authorize('admin'), attendanceReportController.getMonthlyReport);
router.get('/settings', authenticate, authorize('admin'), attendanceController.getAttendanceSettings);
router.put('/settings', authenticate, authorize('admin'), attendanceController.updateAttendanceSettings);

// Monthly attendance report module
router.get('/report/monthly', authenticate, authorize('admin'), attendanceReportController.getMonthlyReport);
router.get('/report/employee/:id', authenticate, attendanceReportController.getEmployeeReport);
router.get('/calendar/:id', authenticate, attendanceReportController.getAttendanceCalendar);
router.get('/dashboard', authenticate, authorize('admin'), attendanceReportController.getAttendanceDashboard);

module.exports = router;
