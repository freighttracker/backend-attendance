const express = require('express');
const router = express.Router();
const holidayController = require('../controllers/holiday.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, holidayController.getHolidays);
router.get('/:id', authenticate, holidayController.getHoliday);
router.post('/', authenticate, authorize('superadmin', 'admin'), holidayController.createHoliday);
router.post('/bulk', authenticate, authorize('superadmin', 'admin'), holidayController.bulkCreateHolidays);
router.put('/:id', authenticate, authorize('superadmin', 'admin'), holidayController.updateHoliday);
router.delete('/:id', authenticate, authorize('superadmin', 'admin'), holidayController.deleteHoliday);

module.exports = router;
