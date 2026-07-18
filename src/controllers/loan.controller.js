const Loan = require('../models/Loan');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Request/create a loan
// @route   POST /api/payroll/loans
// @access  Private (self) / Private/Admin (on behalf of an employee)
exports.createLoan = async (req, res) => {
    try {
        const { userId, loanAmount, reason, emiAmount, tenureMonths, startMonth, startYear } = req.body;
        if (!loanAmount || !emiAmount || !tenureMonths || !startMonth || !startYear) {
            return errorResponse(res, 'loanAmount, emiAmount, tenureMonths, startMonth and startYear are required', 400);
        }

        const targetUser = (req.user.role === 'admin' && userId) ? userId : req.user.id;

        const loan = await Loan.create({
            user: targetUser,
            loanAmount,
            reason,
            emiAmount,
            tenureMonths,
            startMonth,
            startYear,
            remainingBalance: loanAmount,
            createdBy: req.user.id,
            // Admin-initiated loans are auto-approved; employee self-requests need admin approval.
            status: req.user.role === 'admin' ? 'active' : 'pending',
            approvedBy: req.user.role === 'admin' ? req.user.id : undefined,
            approvedAt: req.user.role === 'admin' ? new Date() : undefined
        });

        logger.info(`Loan created for user ${targetUser} - amount ${loanAmount} by ${req.user.email}`);
        return successResponse(res, loan, 'Loan created successfully', 201);
    } catch (error) {
        logger.error('Create loan error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get all loans
// @route   GET /api/payroll/loans
// @access  Private/Admin
exports.getLoans = async (req, res) => {
    try {
        const { page = 1, limit = 20, userId, status } = req.query;
        const query = {};
        if (userId) query.user = userId;
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Loan.countDocuments(query);
        const loans = await Loan.find(query)
            .populate('user', 'firstName lastName employeeCode department')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, loans, {
            page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        logger.error('Get loans error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get my loans
// @route   GET /api/payroll/loans/my
// @access  Private
exports.getMyLoans = async (req, res) => {
    try {
        const loans = await Loan.find({ user: req.user.id }).sort({ createdAt: -1 });
        return successResponse(res, loans, 'Loans retrieved');
    } catch (error) {
        logger.error('Get my loans error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get a single loan with its EMI deduction history
// @route   GET /api/payroll/loans/:id
// @access  Private (self) / Private/Admin (any)
exports.getLoan = async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id).populate('user', 'firstName lastName employeeCode');
        if (!loan) return errorResponse(res, 'Loan not found', 404);
        if (req.user.role !== 'admin' && loan.user._id.toString() !== req.user.id) {
            return errorResponse(res, 'Not authorized', 403);
        }
        return successResponse(res, loan, 'Loan retrieved');
    } catch (error) {
        logger.error('Get loan error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Approve a pending loan request
// @route   PUT /api/payroll/loans/:id/approve
// @access  Private/Admin
exports.approveLoan = async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id);
        if (!loan) return errorResponse(res, 'Loan not found', 404);
        if (loan.status !== 'pending') return errorResponse(res, 'Only pending loans can be approved', 400);

        loan.status = 'active';
        loan.approvedBy = req.user.id;
        loan.approvedAt = new Date();
        await loan.save();

        return successResponse(res, loan, 'Loan approved');
    } catch (error) {
        logger.error('Approve loan error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Reject a pending loan request
// @route   PUT /api/payroll/loans/:id/reject
// @access  Private/Admin
exports.rejectLoan = async (req, res) => {
    try {
        const loan = await Loan.findByIdAndUpdate(
            req.params.id,
            { status: 'rejected' },
            { new: true }
        );
        if (!loan) return errorResponse(res, 'Loan not found', 404);
        return successResponse(res, loan, 'Loan rejected');
    } catch (error) {
        logger.error('Reject loan error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Cancel/close an active loan (e.g. settled outside payroll)
// @route   PUT /api/payroll/loans/:id/close
// @access  Private/Admin
exports.closeLoan = async (req, res) => {
    try {
        const loan = await Loan.findByIdAndUpdate(
            req.params.id,
            { status: 'closed' },
            { new: true }
        );
        if (!loan) return errorResponse(res, 'Loan not found', 404);
        return successResponse(res, loan, 'Loan closed');
    } catch (error) {
        logger.error('Close loan error:', error);
        return errorResponse(res, error.message, 500);
    }
};
