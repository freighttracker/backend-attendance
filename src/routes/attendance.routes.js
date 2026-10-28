const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance.controller');
const attendanceReportController = require('../controllers/attendanceReport.controller');
const geoAttendanceController = require('../controllers/geoAttendance.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');
const { requireGeoPermission } = require('../services/geoAccess.service');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');

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
// Corrections are reviewable by every admin tier; attachScope + the
// controllers' scope checks keep company/subcompany admins to their own staff.
router.get('/corrections', authenticate, anyAdmin, attachScope, attendanceController.getCorrectionRequests);
router.put('/corrections/:id', authenticate, anyAdmin, attachScope, attendanceController.handleCorrectionRequest);
// Overtime is unpaid until an admin approves it here.
router.get('/overtime', authenticate, anyAdmin, attachScope, attendanceController.getOvertimeRequests);
router.put('/overtime/:id', authenticate, anyAdmin, attachScope, attendanceController.handleOvertimeRequest);
// Approved (excused) late arrivals are ignored by the payroll late policy.
router.get('/late', authenticate, anyAdmin, attachScope, attendanceController.getLateRequests);
router.put('/late/:id', authenticate, anyAdmin, attachScope, attendanceController.handleLateRequest);

// Half days approved here are paid as full days.    
router.get('/half-day', authenticate, anyAdmin, attachScope, attendanceController.getHalfDayRequests);
router.put('/half-day/:id', authenticate, anyAdmin, attachScope, attendanceController.handleHalfDayRequest);
router.put('/correct',authenticate, anyAdmin, attachScope, attendanceController.correctAttendanceRecord);
router.post('/lock', authenticate, authorize('superadmin', 'admin'), attendanceController.lockAttendance);
router.get('/report', authenticate, anyAdmin, attachScope, attendanceReportController.getMonthlyReport);
router.get('/settings', authenticate, authorize('superadmin', 'admin'), attendanceController.getAttendanceSettings);
router.put('/settings', authenticate, authorize('superadmin', 'admin'), attendanceController.updateAttendanceSettings);

// Monthly attendance report module - attachScope is applied unconditionally
// (not gated behind anyAdmin) because getEmployeeReport/getAttendanceCalendar
// are also reachable by a plain employee viewing their own record, and
// attachScope just resolves whatever req.scope applies to the caller's role.

router.get('/report/monthly', authenticate, anyAdmin, attachScope, attendanceReportController.getMonthlyReport);
router.get('/report/monthly/pdf', authenticate, anyAdmin, attachScope, attendanceReportController.exportMonthlyReportPdf);
router.get('/report/employee/:id', authenticate, attachScope, attendanceReportController.getEmployeeReport);
router.get('/calendar/:id', authenticate, attachScope, attendanceReportController.getAttendanceCalendar);
router.get('/dashboard', authenticate, anyAdmin, attachScope, attendanceReportController.getAttendanceDashboard);

// GPS / geofenced attendance. Every route re-checks scope and the caller's
// location permissions server-side; the UI hiding a button is not relied on.
const policyManagers = authorize('superadmin', 'admin', 'company_admin');
router.get('/locations', authenticate, anyAdmin, attachScope, requireGeoPermission('canViewLocations'), geoAttendanceController.getAttendanceLocations);
router.get('/geo-policy', authenticate, anyAdmin, attachScope, geoAttendanceController.getGeoPolicy);
router.put(
    '/geo-policy',
    authenticate, policyManagers, attachScope, requireGeoPermission('canManageOffices'),
    body('checkInMode').optional().isIn(['off', 'flag', 'enforce']).withMessage('checkInMode must be off, flag or enforce'),
    body('checkOutMode').optional().isIn(['off', 'flag', 'enforce']).withMessage('checkOutMode must be off, flag or enforce'),
    body('defaultRadiusMeters').optional().isInt({ min: 10, max: 5000 }).withMessage('Default radius must be 10-5000 metres').toInt(),
    body('maxAccuracyMeters').optional().isInt({ min: 5, max: 2000 }).withMessage('Maximum GPS accuracy must be 5-2000 metres').toInt(),
    body('allowExceptions').optional().isBoolean().withMessage('allowExceptions must be true or false').toBoolean(),
    body('locationRetentionDays').optional().isInt({ min: 30, max: 3650 }).withMessage('Retention must be 30-3650 days').toInt(),
    validate,
    geoAttendanceController.updateGeoPolicy
);
router.get('/geo-audit-logs', authenticate, policyManagers, attachScope, geoAttendanceController.getGeoAuditLogs);
router.get('/:id/location', authenticate, attachScope, geoAttendanceController.getAttendanceLocation);
router.put('/:id/location-review', authenticate, anyAdmin, attachScope, requireGeoPermission('canReviewExceptions'), geoAttendanceController.reviewAttendanceLocation);

module.exports = router;
