const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { errorResponse } = require('../utils/responseHelper');

const authenticate = async (req, res, next) => {

  try {
        const authHeader = req.headers.authorization;


        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return errorResponse(res, 'Access denied. No token provided.', 401);
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.userId);

        if (!user) {
            return errorResponse(res, 'User not found.', 401);
        }

        if (!user.isActive) {
            return errorResponse(res, 'Account is deactivated.', 403);
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return errorResponse(res, 'Token expired. Please login again.', 401);
        }
        if (error.name === 'JsonWebTokenError') {
            return errorResponse(res, 'Invalid token.', 401);
        }
        return errorResponse(res, 'Authentication failed.', 500);
    }
};

const authorize = (...roles) => {

    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return errorResponse(res, 'Access denied. Insufficient permissions.', 403);
        }
        next();
    };
    
};

module.exports = { authenticate, authorize };

