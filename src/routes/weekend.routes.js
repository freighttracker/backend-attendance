const express = require('express');
const router = express.Router();
const weekendController = require('../controllers/weekend.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, weekendController.getWeekendConfigs);
router.put('/:id', authenticate, authorize('admin'), weekendController.updateWeekendConfig);
router.put('/bulk', authenticate, authorize('admin'), weekendController.bulkUpdateWeekendConfig);

module.exports = router;
