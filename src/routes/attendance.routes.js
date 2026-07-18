const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendance.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Employee routes
router.post('/check-in', authenticate, attendanceController.checkIn);
router.post('/check-out', authenticate, attendanceController.checkOut);
router.get('/today', authenticate, attendanceController.getTodayAttendance);
router.get('/history', authenticate, attendanceController.getAttendanceHistory);
router.get('/working-hours', authenticate, attendanceController.getWorkingHours);
router.post('/correction', authenticate, attendanceController.requestCorrection);
router.get('/my-corrections', authenticate, attendanceController.getMyCorrectionRequests);

// Admin routes
router.get('/all', authenticate, authorize('admin'), attendanceController.getAllAttendance);
router.get('/corrections', authenticate, authorize('admin'), attendanceController.getCorrectionRequests);
router.put('/corrections/:id', authenticate, authorize('admin'), attendanceController.handleCorrectionRequest);
router.post('/lock', authenticate, authorize('admin'), attendanceController.lockAttendance);

module.exports = router;
