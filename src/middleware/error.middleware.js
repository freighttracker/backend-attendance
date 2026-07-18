const { logger } = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    logger.error(err);

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map(val => val.message);
        return res.status(400).json({
            success: false,
            message: 'Validation Error',
            errors: messages,
            timestamp: new Date().toISOString()
        });
    }

    // Mongoose duplicate key error
    if (err.code === 11000) {
        return res.status(409).json({
            success: false,
            message: 'Duplicate entry. Record already exists.',
            timestamp: new Date().toISOString()
        });
    }

    // Mongoose cast error (invalid ObjectId)
    if (err.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: `Invalid ${err.path}: ${err.value}`,
            timestamp: new Date().toISOString()
        });
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid token',
            timestamp: new Date().toISOString()
        });
    }

    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Token expired',
            timestamp: new Date().toISOString()
        });
    }

    // Multer error
    if (err.name === 'MulterError') {
        return res.status(400).json({
            success: false,
            message: err.message,
            timestamp: new Date().toISOString()
        });
    }

    // Default error
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
        timestamp: new Date().toISOString()
    });
};

module.exports = { errorHandler };
