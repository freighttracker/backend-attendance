const express = require('express');
const router = express.Router();
const settingController = require('../controllers/setting.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, authorize('admin'), settingController.getSettings);
router.post('/', authenticate, authorize('admin'), settingController.createSetting);
router.get('/attendance-rules', authenticate, authorize('admin'), settingController.getAttendanceRules);
router.post('/attendance-rules', authenticate, authorize('admin'), settingController.createAttendanceRule);
router.put('/attendance-rules/:id', authenticate, authorize('admin'), settingController.updateAttendanceRule);
router.delete('/attendance-rules/:id', authenticate, authorize('admin'), settingController.deleteAttendanceRule);
router.get('/sandwich-policy', authenticate, authorize('admin'), settingController.getSandwichPolicy);
router.put('/sandwich-policy', authenticate, authorize('admin'), settingController.updateSandwichPolicy);
router.put('/features/:feature', authenticate, authorize('admin'), settingController.toggleFeature);
router.get('/:key', authenticate, settingController.getSettingByKey);
router.put('/:key', authenticate, authorize('admin'), settingController.updateSetting);

module.exports = router;
