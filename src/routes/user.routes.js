const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

// Admin routes
router.get('/', authenticate, authorize('admin'), userController.getAllUsers);
router.post('/', authenticate, authorize('admin'), userController.createUser);
router.post('/bulk-upload', authenticate, authorize('admin'), upload.single('file'), userController.bulkUpload);
router.get('/departments/list', authenticate, userController.getDepartments);

// Profile routes
router.get('/profile/me', authenticate, userController.getMyProfile);
router.put('/profile/me', authenticate, userController.updateMyProfile);
router.post('/avatar', authenticate, upload.single('avatar'), userController.uploadAvatar);

// Single user routes
router.get('/:id', authenticate, userController.getUser);
router.put('/:id', authenticate, authorize('admin'), userController.updateUser);
router.delete('/:id', authenticate, authorize('admin'), userController.deleteUser);

module.exports = router;
