const Notification = require('../models/Notification');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { logger } = require('../utils/logger');

// @desc    Get my notifications
// @route   GET /api/notifications
// @access  Private
exports.getMyNotifications = async (req, res) => {
    
    try {

        const { page = 1, limit = 20, unreadOnly = false } = req.query;
        const userId = req.user.id;

        const query = { user: userId };
        if (unreadOnly === 'true') query.isRead = false;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const total = await Notification.countDocuments(query);

        const notifications = await Notification.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        return paginatedResponse(res, notifications, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
        });


    } catch (error) {
        logger.error('Get notifications error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
exports.markAsRead = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user.id },
            { isRead: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) return errorResponse(res, 'Notification not found', 404);
        return successResponse(res, notification, 'Notification marked as read');
    } catch (error) {
        logger.error('Mark as read error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
exports.markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { user: req.user.id, isRead: false },
            { isRead: true, readAt: new Date() }
        );
        return successResponse(res, null, 'All notifications marked as read');
    } catch (error) {
        logger.error('Mark all as read error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Get unread count
// @route   GET /api/notifications/unread-count
// @access  Private
exports.getUnreadCount = async (req, res) => {
    try {
        const count = await Notification.countDocuments({
            user: req.user.id,
            isRead: false
        });
        return successResponse(res, { count }, 'Unread count retrieved');
    } catch (error) {
        logger.error('Get unread count error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Create notification (Admin/Internal)
// @route   POST /api/notifications
// @access  Private/Admin
exports.createNotification = async (req, res) => {
    try {
        const { userId, title, message, type, actionUrl } = req.body;

        const notification = await Notification.create({
            user: userId,
            title,
            message,
            type: type || 'info',
            actionUrl
        });

        return successResponse(res, notification, 'Notification created', 201);
    } catch (error) {
        logger.error('Create notification error:', error);
        return errorResponse(res, error.message, 500);
    }
};

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
exports.deleteNotification = async (req, res) => {
    try {
        const notification = await Notification.findOneAndDelete({
            _id: req.params.id,
            user: req.user.id
        });

        if (!notification) return errorResponse(res, 'Notification not found', 404);
        return successResponse(res, null, 'Notification deleted');
    } catch (error) {
        logger.error('Delete notification error:', error);
        return errorResponse(res, error.message, 500);
    }
};
