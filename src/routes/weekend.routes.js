const express = require('express');
const router = express.Router();
const weekendController = require('../controllers/weekend.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, weekendController.getWeekendConfigs);
router.put('/bulk', authenticate, authorize('admin'), weekendController.bulkUpdateWeekendConfig);
router.put('/:id', authenticate, authorize('admin'), weekendController.updateWeekendConfig);

module.exports = router;
