const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');
const upload = require('../middleware/upload.middleware');

// Any admin tier can reach these routes; attachScope + the controller then
// narrow what each tier actually sees/can touch.
const anyAdmin = authorize('superadmin', 'admin', 'company_admin', 'subcompany_admin');

// Admin routes
router.get('/', authenticate, anyAdmin, attachScope, userController.getAllUsers);
router.post('/', authenticate, anyAdmin, attachScope, userController.createUser);
router.post('/bulk-upload', authenticate, authorize('superadmin', 'admin'), upload.single('file'), userController.bulkUpload);
router.get('/departments/list', authenticate, userController.getDepartments);

// Profile routes
router.get('/profile/me', authenticate, userController.getMyProfile);
router.put('/profile/me', authenticate, userController.updateMyProfile);
router.post('/avatar', authenticate, upload.single('avatar'), userController.uploadAvatar);

// Single user routes
router.get('/:id', authenticate, attachScope, userController.getUser);
router.put('/:id', authenticate, anyAdmin, attachScope, userController.updateUser);
router.delete('/:id', authenticate, anyAdmin, attachScope, userController.deleteUser);

module.exports = router;
