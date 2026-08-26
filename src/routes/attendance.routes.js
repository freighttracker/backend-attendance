const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance.controller');
const attendanceReportController = require('../controllers/attendanceReport.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');

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
const anyAdmin = authorize('superadmin', 'admin', 'company_admin', 'subcompany_admin');
router.get('/all', authenticate, anyAdmin, attachScope, attendanceController.getAllAttendance);
router.get('/corrections', authenticate, authorize('superadmin', 'admin'), attendanceController.getCorrectionRequests);
router.put('/corrections/:id', authenticate, authorize('superadmin', 'admin'), attendanceController.handleCorrectionRequest);
router.put('/correct', authenticate, authorize('superadmin', 'admin'), attendanceController.correctAttendanceRecord);
router.post('/lock', authenticate, authorize('superadmin', 'admin'), attendanceController.lockAttendance);
router.get('/report', authenticate, anyAdmin, attachScope, attendanceReportController.getMonthlyReport);
router.get('/settings', authenticate, authorize('superadmin', 'admin'), attendanceController.getAttendanceSettings);
router.put('/settings', authenticate, authorize('superadmin', 'admin'), attendanceController.updateAttendanceSettings);

// Monthly attendance report module - attachScope is applied unconditionally
// (not gated behind anyAdmin) because getEmployeeReport/getAttendanceCalendar
// are also reachable by a plain employee viewing their own record, and
// attachScope just resolves whatever req.scope applies to the caller's role.
router.get('/report/monthly', authenticate, anyAdmin, attachScope, attendanceReportController.getMonthlyReport);
router.get('/report/employee/:id', authenticate, attachScope, attendanceReportController.getEmployeeReport);
router.get('/calendar/:id', authenticate, attachScope, attendanceReportController.getAttendanceCalendar);
router.get('/dashboard', authenticate, anyAdmin, attachScope, attendanceReportController.getAttendanceDashboard);

module.exports = router;
