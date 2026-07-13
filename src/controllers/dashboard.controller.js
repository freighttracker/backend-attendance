const moment = require('moment-timezone');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const LeaveRequest = require('../models/LeaveRequest');
const SalarySlip = require('../models/SalarySlip');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Get admin dashboard stats
// @route   GET /api/dashboard/admin
// @access  Private/Admin
exports.getAdminDashboard = async (req, res) => {
    try {
        const today = moment().startOf('day').toDate();
        const startOfMonth = moment().startOf('month').toDate();
        const endOfMonth = moment().endOf('month').toDate();

        // Employee stats
        const totalEmployees = await User.countDocuments({ role: 'employee', isActive: true });
        const newEmployees = await User.countDocuments({
            role: 'employee',
            createdAt: { $gte: startOfMonth }
        });

        // Today's attendance
        const todayAttendance = await AttendanceRecord.find({ date: today });
        const presentToday = todayAttendance.filter(a => a.status === 'present').length;
        const absentToday = todayAttendance.filter(a => a.status === 'absent').length;
        const onLeaveToday = todayAttendance.filter(a => a.status === 'on_leave').length;
        const lateToday = todayAttendance.filter(a => a.isLate).length;

        // Pending leave requests
        const pendingLeaves = await LeaveRequest.countDocuments({ status: 'pending' });

        // Monthly attendance stats
        const monthlyStats = await AttendanceRecord.aggregate([
            {
                $match: {
                    date: { $gte: startOfMonth, $lte: endOfMonth }
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        // Recent activities (last 5 attendance records)
        const recentAttendance = await AttendanceRecord.find()
            .populate('user', 'firstName lastName employeeCode')
            .sort({ createdAt: -1 })
            .limit(10);

        return successResponse(res, {
            employeeStats: { totalEmployees, newEmployees },
            todayAttendance: {
                present: presentToday,
                absent: absentToday,
                onLeave: onLeaveToday,
                late: lateToday,
                total: totalEmployees
            },
            pendingLeaves,
            monthlyStats,
            recentAttendance
        }, 'Admin dashboard data retrieved');
    } catch (error) {
        logger.error('Admin dashboard error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get employee dashboard stats
// @route   GET /api/dashboard/employee
// @access  Private
exports.getEmployeeDashboard = async (req, res) => {
    try {
        const userId = req.user.id;
        const today = moment().startOf('day').toDate();
        const startOfMonth = moment().startOf('month').toDate();
        const endOfMonth = moment().endOf('month').toDate();

        // Today's status
        const todayRecord = await AttendanceRecord.findOne({ user: userId, date: today });

        // Monthly stats
        const monthlyRecords = await AttendanceRecord.find({
            user: userId,
            date: { $gte: startOfMonth, $lte: endOfMonth }
        });

        const presentDays = monthlyRecords.filter(r => r.status === 'present').length;
        const absentDays = monthlyRecords.filter(r => r.status === 'absent').length;
        const leaveDays = monthlyRecords.filter(r => r.status === 'on_leave').length;
        const halfDays = monthlyRecords.filter(r => r.status === 'half_day').length;
        const lateCount = monthlyRecords.filter(r => r.isLate).length;
        const totalWorkingHours = monthlyRecords.reduce((sum, r) => sum + (r.workingHours || 0), 0);
        const totalOvertime = monthlyRecords.reduce((sum, r) => sum + (r.overtimeHours || 0), 0);

        // Pending leave requests
        const pendingLeaves = await LeaveRequest.countDocuments({
            user: userId,
            status: 'pending'
        });

        // Recent attendance
        const recentAttendance = await AttendanceRecord.find({ user: userId })
            .sort({ date: -1 })
            .limit(7);

        return successResponse(res, {
            todayStatus: {
                checkedIn: todayRecord ? !!todayRecord.checkIn.time : false,
                checkedOut: todayRecord ? !!todayRecord.checkOut.time : false,
                status: todayRecord ? todayRecord.status : 'absent',
                workingHours: todayRecord ? todayRecord.workingHours : 0
            },
            monthlyStats: {
                presentDays,
                absentDays,
                leaveDays,
                halfDays,
                lateCount,
                totalWorkingHours: parseFloat(totalWorkingHours.toFixed(2)),
                totalOvertime: parseFloat(totalOvertime.toFixed(2))
            },
            pendingLeaves,
            recentAttendance
        }, 'Employee dashboard data retrieved');
    } catch (error) {
        logger.error('Employee dashboard error:', error);
        return errorResponse(res, error.message, 500);
    }
};
