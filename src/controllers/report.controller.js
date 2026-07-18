const moment = require('moment-timezone');
const AttendanceRecord = require('../models/AttendanceRecord');
const User = require('../models/User');
const LeaveRequest = require('../models/LeaveRequest');
const SalarySlip = require('../models/SalarySlip');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Get attendance report
// @route   GET /api/reports/attendance
// @access  Private/Admin
exports.getAttendanceReport = async (req, res) => {
    try {
        const { startDate, endDate, department, userId } = req.query;

        const query = {};
        if (startDate && endDate) {
            query.date = {
                $gte: moment(startDate).startOf('day').toDate(),
                $lte: moment(endDate).endOf('day').toDate()
            };
        }
        if (userId) query.user = userId;

        const pipeline = [
            { $match: query },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'userInfo'
                }
            },
            { $unwind: '$userInfo' }
        ];

        if (department) {
            pipeline.push({ $match: { 'userInfo.department': department } });
        }

        pipeline.push(
            {
                $group: {
                    _id: '$user',
                    employeeName: { $first: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] } },
                    employeeCode: { $first: '$userInfo.employeeCode' },
                    department: { $first: '$userInfo.department' },
                    totalDays: { $sum: 1 },
                    presentDays: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
                    absentDays: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
                    halfDays: { $sum: { $cond: [{ $eq: ['$status', 'half_day'] }, 1, 0] } },
                    leaveDays: { $sum: { $cond: [{ $eq: ['$status', 'on_leave'] }, 1, 0] } },
                    wfhDays: { $sum: { $cond: [{ $eq: ['$status', 'wfh'] }, 1, 0] } },
                    lateCount: { $sum: { $cond: ['$isLate', 1, 0] } },
                    earlyLeaveCount: { $sum: { $cond: ['$isEarlyLeave', 1, 0] } },
                    totalWorkingHours: { $sum: '$workingHours' },
                    totalOvertime: { $sum: '$overtimeHours' }
                }
            },
            { $sort: { employeeName: 1 } }
        );

        const report = await AttendanceRecord.aggregate(pipeline);
        return successResponse(res, report, 'Attendance report generated');
    } catch (error) {
        logger.error('Attendance report error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get leave report
// @route   GET /api/reports/leaves
// @access  Private/Admin
exports.getLeaveReport = async (req, res) => {
    try {
        const { year, department, leaveType } = req.query;
        const currentYear = year || new Date().getFullYear();

        const pipeline = [
            {
                $match: {
                    status: 'approved',
                    $or: [
                        { startDate: { $gte: new Date(`${currentYear}-01-01`), $lte: new Date(`${currentYear}-12-31`) } },
                        { endDate: { $gte: new Date(`${currentYear}-01-01`), $lte: new Date(`${currentYear}-12-31`) } }
                    ]
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'userInfo'
                }
            },
            { $unwind: '$userInfo' },
            {
                $lookup: {
                    from: 'leavetypes',
                    localField: 'leaveType',
                    foreignField: '_id',
                    as: 'leaveTypeInfo'
                }
            },
            { $unwind: '$leaveTypeInfo' }
        ];

        if (department) {
            pipeline.push({ $match: { 'userInfo.department': department } });
        }
        if (leaveType) {
            pipeline.push({ $match: { 'leaveTypeInfo._id': require('mongoose').Types.ObjectId(leaveType) } });
        }

        pipeline.push(
            {
                $group: {
                    _id: {
                        user: '$user',
                        leaveType: '$leaveType'
                    },
                    employeeName: { $first: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] } },
                    employeeCode: { $first: '$userInfo.employeeCode' },
                    department: { $first: '$userInfo.department' },
                    leaveTypeName: { $first: '$leaveTypeInfo.name' },
                    leaveTypeCode: { $first: '$leaveTypeInfo.code' },
                    totalDays: { $sum: '$totalDays' },
                    requestCount: { $sum: 1 }
                }
            },
            { $sort: { employeeName: 1 } }
        );

        const report = await LeaveRequest.aggregate(pipeline);
        return successResponse(res, report, 'Leave report generated');
    } catch (error) {
        logger.error('Leave report error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get salary report
// @route   GET /api/reports/salary
// @access  Private/Admin
exports.getSalaryReport = async (req, res) => {
    try {
        const { month, year, department } = req.query;

        const query = { status: { $in: ['approved', 'paid'] } };
        if (month) query.month = parseInt(month);
        if (year) query.year = parseInt(year);

        const pipeline = [
            { $match: query },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'userInfo'
                }
            },
            { $unwind: '$userInfo' }
        ];

        if (department) {
            pipeline.push({ $match: { 'userInfo.department': department } });
        }

        pipeline.push(
            {
                $group: {
                    _id: null,
                    totalEmployees: { $sum: 1 },
                    totalGrossSalary: { $sum: '$grossSalary' },
                    totalDeductions: { $sum: '$totalDeductions' },
                    totalNetSalary: { $sum: '$netSalary' },
                    avgNetSalary: { $avg: '$netSalary' },
                    totalOvertime: { $sum: '$attendance.overtimeHours' }
                }
            }
        );

        const summary = await SalarySlip.aggregate(pipeline);

        // Get individual records
        const records = await SalarySlip.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .sort({ netSalary: -1 });

        return successResponse(res, { summary: summary[0] || {}, records }, 'Salary report generated');
    } catch (error) {
        logger.error('Salary report error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get monthly summary
// @route   GET /api/reports/monthly-summary
// @access  Private/Admin
exports.getMonthlySummary = async (req, res) => {
    try {
        const { month, year } = req.query;
        const targetMonth = parseInt(month) || new Date().getMonth() + 1;
        const targetYear = parseInt(year) || new Date().getFullYear();

        const startOfMonth = moment(`${targetYear}-${targetMonth}-01`).startOf('month').toDate();
        const endOfMonth = moment(startOfMonth).endOf('month').toDate();

        // Attendance stats
        const attendanceStats = await AttendanceRecord.aggregate([
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

        // Leave stats
        const leaveStats = await LeaveRequest.aggregate([
            {
                $match: {
                    status: 'approved',
                    $or: [
                        { startDate: { $gte: startOfMonth, $lte: endOfMonth } },
                        { endDate: { $gte: startOfMonth, $lte: endOfMonth } }
                    ]
                }
            },
            {
                $group: {
                    _id: '$leaveType',
                    totalDays: { $sum: '$totalDays' },
                    count: { $sum: 1 }
                }
            },
            {
                $lookup: {
                    from: 'leavetypes',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'leaveType'
                }
            },
            { $unwind: '$leaveType' }
        ]);

        // Employee count
        const totalEmployees = await User.countDocuments({ role: 'employee', isActive: true });
        const newEmployees = await User.countDocuments({
            role: 'employee',
            createdAt: { $gte: startOfMonth, $lte: endOfMonth }
        });

        return successResponse(res, {
            month: targetMonth,
            year: targetYear,
            totalEmployees,
            newEmployees,
            attendanceStats,
            leaveStats
        }, 'Monthly summary generated');
    } catch (error) {
        logger.error('Monthly summary error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get late comers report
// @route   GET /api/reports/late-comers
// @access  Private/Admin
exports.getLateComersReport = async (req, res) => {
    try {
        const { startDate, endDate, department } = req.query;

        const query = { isLate: true };
        if (startDate && endDate) {
            query.date = {
                $gte: moment(startDate).startOf('day').toDate(),
                $lte: moment(endDate).endOf('day').toDate()
            };
        }

        const pipeline = [
            { $match: query },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'userInfo'
                }
            },
            { $unwind: '$userInfo' }
        ];

        if (department) {
            pipeline.push({ $match: { 'userInfo.department': department } });
        }

        pipeline.push(
            {
                $group: {
                    _id: '$user',
                    employeeName: { $first: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] } },
                    employeeCode: { $first: '$userInfo.employeeCode' },
                    department: { $first: '$userInfo.department' },
                    lateCount: { $sum: 1 },
                    totalLateMinutes: { $sum: '$lateMinutes' },
                    avgLateMinutes: { $avg: '$lateMinutes' }
                }
            },
            { $sort: { lateCount: -1 } }
        );

        const report = await AttendanceRecord.aggregate(pipeline);
        return successResponse(res, report, 'Late comers report generated');
    } catch (error) {
        logger.error('Late comers report error:', error);
        return errorResponse(res, error.message, 500);
    }
};
