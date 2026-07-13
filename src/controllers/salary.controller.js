const moment = require('moment-timezone');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const SalarySlip = require('../models/SalarySlip');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const LeaveRequest = require('../models/LeaveRequest');
const SystemSetting = require('../models/SystemSetting');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// Calculate salary components
const calculateSalary = async (userId, month, year) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const startOfMonth = moment(`${year}-${month}-01`).startOf('month').toDate();
    const endOfMonth = moment(startOfMonth).endOf('month').toDate();
    const daysInMonth = moment(startOfMonth).daysInMonth();

    // Get attendance records
    const attendanceRecords = await AttendanceRecord.find({
        user: userId,
        date: { $gte: startOfMonth, $lte: endOfMonth }
    });

    const presentDays = attendanceRecords.filter(r => r.status === 'present').length;
    const halfDays = attendanceRecords.filter(r => r.status === 'half_day').length;
    const absentDays = attendanceRecords.filter(r => r.status === 'absent').length;
    const leaveDays = attendanceRecords.filter(r => r.status === 'on_leave').length;
    const lateCount = attendanceRecords.filter(r => r.isLate).length;
    const totalOvertime = attendanceRecords.reduce((sum, r) => sum + (r.overtimeHours || 0), 0);

    // Working days calculation (excluding weekends and holidays)
    const workingDays = daysInMonth; // Simplified - can be enhanced

    // Earnings
    const basicSalary = user.baseSalary || 0;
    const hra = basicSalary * 0.4; // 40% of basic
    const da = basicSalary * 0.1;  // 10% of basic
    const conveyance = 1600;
    const medical = 1250;
    const specialAllowance = basicSalary * 0.15;

    // Overtime calculation
    const overtimeRate = (basicSalary / (workingDays * 8)) * 1.5;
    const overtimeAmount = totalOvertime * overtimeRate;

    const grossSalary = basicSalary + hra + da + conveyance + medical + specialAllowance + overtimeAmount;

    // Deductions
    const pfDeduction = Math.min(basicSalary * 0.12, 1800); // 12% of basic, max 1800
    const esiDeduction = grossSalary <= 21000 ? grossSalary * 0.0075 : 0;
    const professionalTax = grossSalary > 15000 ? 200 : 0;

    // Leave deduction (for LOP)
    const leaveDeduction = (absentDays * (basicSalary / workingDays));
    const lateDeduction = lateCount > 3 ? (lateCount - 3) * (basicSalary / workingDays / 2) : 0;

    const totalDeductions = pfDeduction + esiDeduction + professionalTax + leaveDeduction + lateDeduction;
    const netSalary = grossSalary - totalDeductions;

    return {
        user: userId,
        month: parseInt(month),
        year: parseInt(year),
        earnings: {
            basicSalary: Math.round(basicSalary * 100) / 100,
            hra: Math.round(hra * 100) / 100,
            da: Math.round(da * 100) / 100,
            conveyance: Math.round(conveyance * 100) / 100,
            medical: Math.round(medical * 100) / 100,
            specialAllowance: Math.round(specialAllowance * 100) / 100,
            overtimeAmount: Math.round(overtimeAmount * 100) / 100
        },
        deductions: {
            pfDeduction: Math.round(pfDeduction * 100) / 100,
            esiDeduction: Math.round(esiDeduction * 100) / 100,
            professionalTax: Math.round(professionalTax * 100) / 100,
            leaveDeduction: Math.round(leaveDeduction * 100) / 100,
            lateDeduction: Math.round(lateDeduction * 100) / 100
        },
        grossSalary: Math.round(grossSalary * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        netSalary: Math.round(netSalary * 100) / 100,
        attendance: {
            workingDays,
            presentDays,
            absentDays,
            leaveDays,
            halfDays,
            overtimeHours: Math.round(totalOvertime * 100) / 100,
            lateCount
        }
    };
};

// Generate PDF salary slip
const generateSalarySlipPDF = async (salarySlip) => {
    const user = await User.findById(salarySlip.user);
    const doc = new PDFDocument();
    const fileName = `salary-slip-${user.employeeCode}-${salarySlip.month}-${salarySlip.year}.pdf`;
    const filePath = path.join(__dirname, '../../uploads/documents', fileName);

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.fontSize(20).text('SALARY SLIP', { align: 'center' });
    doc.moveDown();

    // Company Info
    const companyName = await SystemSetting.findOne({ settingKey: 'company_name' });
    doc.fontSize(14).text(companyName?.settingValue || 'Company Name', { align: 'center' });
    doc.moveDown();

    // Employee Info
    doc.fontSize(12);
    doc.text(`Employee Name: ${user.fullName}`);
    doc.text(`Employee Code: ${user.employeeCode}`);
    doc.text(`Department: ${user.department || 'N/A'}`);
    doc.text(`Designation: ${user.designation || 'N/A'}`);
    doc.text(`Month: ${moment.months(salarySlip.month - 1)} ${salarySlip.year}`);
    doc.moveDown();

    // Earnings
    doc.fontSize(14).text('EARNINGS', { underline: true });
    doc.fontSize(12);
    doc.text(`Basic Salary: ${salarySlip.earnings.basicSalary.toFixed(2)}`);
    doc.text(`HRA: ${salarySlip.earnings.hra.toFixed(2)}`);
    doc.text(`DA: ${salarySlip.earnings.da.toFixed(2)}`);
    doc.text(`Conveyance: ${salarySlip.earnings.conveyance.toFixed(2)}`);
    doc.text(`Medical: ${salarySlip.earnings.medical.toFixed(2)}`);
    doc.text(`Special Allowance: ${salarySlip.earnings.specialAllowance.toFixed(2)}`);
    doc.text(`Overtime: ${salarySlip.earnings.overtimeAmount.toFixed(2)}`);
    doc.text(`Gross Salary: ${salarySlip.grossSalary.toFixed(2)}`, { bold: true });
    doc.moveDown();

    // Deductions
    doc.fontSize(14).text('DEDUCTIONS', { underline: true });
    doc.fontSize(12);
    doc.text(`PF: ${salarySlip.deductions.pfDeduction.toFixed(2)}`);
    doc.text(`ESI: ${salarySlip.deductions.esiDeduction.toFixed(2)}`);
    doc.text(`Professional Tax: ${salarySlip.deductions.professionalTax.toFixed(2)}`);
    doc.text(`Leave Deduction: ${salarySlip.deductions.leaveDeduction.toFixed(2)}`);
    doc.text(`Late Deduction: ${salarySlip.deductions.lateDeduction.toFixed(2)}`);
    doc.text(`Total Deductions: ${salarySlip.totalDeductions.toFixed(2)}`, { bold: true });
    doc.moveDown();

    // Net Salary
    doc.fontSize(16).text(`NET SALARY: ${salarySlip.netSalary.toFixed(2)}`, { align: 'center', underline: true });
    doc.moveDown();

    // Attendance Summary
    doc.fontSize(12);
    doc.text(`Working Days: ${salarySlip.attendance.workingDays}`);
    doc.text(`Present Days: ${salarySlip.attendance.presentDays}`);
    doc.text(`Absent Days: ${salarySlip.attendance.absentDays}`);
    doc.text(`Leave Days: ${salarySlip.attendance.leaveDays}`);
    doc.text(`Half Days: ${salarySlip.attendance.halfDays}`);
    doc.text(`Overtime Hours: ${salarySlip.attendance.overtimeHours}`);
    doc.text(`Late Count: ${salarySlip.attendance.lateCount}`);

    doc.end();

    return new Promise((resolve, reject) => {
        stream.on('finish', () => resolve(`/uploads/documents/${fileName}`));
        stream.on('error', reject);
    });
};

// @desc    Generate salary slip
// @route   POST /api/salary/generate
// @access  Private/Admin
exports.generateSalarySlip = async (req, res) => {
    try {
        const { userId, month, year } = req.body;

        // Check if already exists
        const existing = await SalarySlip.findOne({ user: userId, month, year });
        if (existing) {
            return errorResponse(res, 'Salary slip already exists for this month', 409);
        }

        const salaryData = await calculateSalary(userId, month, year);
        salaryData.generatedBy = req.user.id;
        salaryData.status = 'generated';

        const salarySlip = await SalarySlip.create(salaryData);

        // Generate PDF
        const pdfUrl = await generateSalarySlipPDF(salarySlip);
        salarySlip.pdfUrl = pdfUrl;
        await salarySlip.save();

        logger.info(`Salary slip generated for user ${userId} - ${month}/${year}`);
        return successResponse(res, salarySlip, 'Salary slip generated successfully', 201);
    } catch (error) {
        logger.error('Generate salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Generate salary slips for all employees
// @route   POST /api/salary/generate-all
// @access  Private/Admin
exports.generateAllSalarySlips = async (req, res) => {
    try {
        const { month, year } = req.body;
        const employees = await User.find({ role: 'employee', isActive: true });

        const results = { success: [], failed: [] };

        for (const employee of employees) {
            try {
                const existing = await SalarySlip.findOne({
                    user: employee._id,
                    month,
                    year
                });

                if (existing) {
                    results.failed.push({ employeeCode: employee.employeeCode, reason: 'Already exists' });
                    continue;
                }

                const salaryData = await calculateSalary(employee._id, month, year);
                salaryData.generatedBy = req.user.id;
                salaryData.status = 'generated';

                const salarySlip = await SalarySlip.create(salaryData);
                const pdfUrl = await generateSalarySlipPDF(salarySlip);
                salarySlip.pdfUrl = pdfUrl;
                await salarySlip.save();

                results.success.push(employee.employeeCode);
            } catch (err) {
                results.failed.push({ employeeCode: employee.employeeCode, reason: err.message });
            }
        }

        logger.info(`Bulk salary generation completed. Success: ${results.success.length}, Failed: ${results.failed.length}`);
        return successResponse(res, results, 'Bulk salary generation completed');
    } catch (error) {
        logger.error('Generate all salary slips error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get my salary slips
// @route   GET /api/salary/my-slips
// @access  Private
exports.getMySalarySlips = async (req, res) => {
    try {
        const { page = 1, limit = 10, year } = req.query;
        const userId = req.user.id;

        const query = { user: userId };
        if (year) query.year = parseInt(year);

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await SalarySlip.countDocuments(query);

        const slips = await SalarySlip.find(query)
            .sort({ year: -1, month: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, slips, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get my salary slips error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get all salary slips (Admin)
// @route   GET /api/salary/all
// @access  Private/Admin
exports.getAllSalarySlips = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, month, year, status } = req.query;

        const query = {};
        if (userId) query.user = userId;
        if (month) query.month = parseInt(month);
        if (year) query.year = parseInt(year);
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await SalarySlip.countDocuments(query);

        const slips = await SalarySlip.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .sort({ year: -1, month: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, slips, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get all salary slips error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get salary slip by ID
// @route   GET /api/salary/:id
// @access  Private
exports.getSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findById(req.params.id)
            .populate('user', 'firstName lastName employeeCode department designation');

        if (!slip) return errorResponse(res, 'Salary slip not found', 404);

        // Check if user is authorized to view
        if (req.user.role !== 'admin' && slip.user._id.toString() !== req.user.id) {
            return errorResponse(res, 'Not authorized', 403);
        }

        return successResponse(res, slip, 'Salary slip retrieved');
    } catch (error) {
        logger.error('Get salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve salary slip
// @route   PUT /api/salary/:id/approve
// @access  Private/Admin
exports.approveSalarySlip = async (req, res) => {
    try {
        const slip = await SalarySlip.findByIdAndUpdate(
            req.params.id,
            {
                status: 'approved',
                approvedBy: req.user.id,
                approvedAt: new Date()
            },
            { new: true }
        );

        if (!slip) return errorResponse(res, 'Salary slip not found', 404);

        logger.info(`Salary slip approved: ${slip._id}`);
        return successResponse(res, slip, 'Salary slip approved');
    } catch (error) {
        logger.error('Approve salary slip error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Mark salary as paid
// @route   PUT /api/salary/:id/pay
// @access  Private/Admin
exports.markAsPaid = async (req, res) => {
    try {
        const { paymentMethod, transactionId } = req.body;

        const slip = await SalarySlip.findByIdAndUpdate(
            req.params.id,
            {
                status: 'paid',
                paidAt: new Date(),
                paymentMethod,
                transactionId
            },
            { new: true }
        );

        if (!slip) return errorResponse(res, 'Salary slip not found', 404);

        logger.info(`Salary marked as paid: ${slip._id}`);
        return successResponse(res, slip, 'Salary marked as paid');
    } catch (error) {
        logger.error('Mark as paid error:', error);
        return errorResponse(res, error.message, 500);
    }
};
