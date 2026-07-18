const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const leaveRoutes = require('./routes/leave.routes');
const holidayRoutes = require('./routes/holiday.routes');
const salaryFieldRoutes = require('./routes/salaryField.routes');
const weekendRoutes = require('./routes/weekend.routes');
const salaryRoutes = require('./routes/salary.routes');
const salaryStructureRoutes = require('./routes/salaryStructure.routes');
const payrollRoutes = require('./routes/payroll.routes');
const bonusRoutes = require('./routes/bonus.routes');
const reimbursementRoutes = require('./routes/reimbursement.routes');
const loanRoutes = require('./routes/loan.routes');
const advanceSalaryRoutes = require('./routes/advanceSalary.routes');
const reportRoutes = require('./routes/report.routes');
const settingRoutes = require('./routes/setting.routes');
const notificationRoutes = require('./routes/notification.routes');
const dashboardRoutes = require('./routes/dashboard.routes');

const { errorHandler } = require('./middleware/error.middleware');
const { logger } = require('./utils/logger');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.CLIENT_URL || '*',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Malformed JSON body handler (must come right after express.json())
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        return res.status(400).json({
            success: false,
            message: 'Invalid JSON in request body',
            timestamp: new Date().toISOString()
        });
    }
    next(err);
});

// Compression
app.use(compression());

// Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Static files
app.use('/uploads', express.static('uploads'));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/salary-fields', salaryFieldRoutes);
app.use('/api/weekends', weekendRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api/payroll/salary-structures', salaryStructureRoutes);
app.use('/api/payroll/bonuses', bonusRoutes);
app.use('/api/payroll/reimbursements', reimbursementRoutes);
app.use('/api/payroll/loans', loanRoutes);
app.use('/api/payroll/advances', advanceSalaryRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

module.exports = app;
