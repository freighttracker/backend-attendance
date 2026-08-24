const express = require('express');
const router = express.Router();
const controller = require('../controllers/bonus.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/my', authenticate, controller.getMyBonuses);

router.get('/', authenticate, authorize('superadmin', 'admin'), controller.getBonuses);
router.post('/', authenticate, authorize('superadmin', 'admin'), controller.createBonus);
router.put('/:id/approve', authenticate, authorize('superadmin', 'admin'), controller.approveBonus);
router.put('/:id/reject', authenticate, authorize('superadmin', 'admin'), controller.rejectBonus);
router.delete('/:id', authenticate, authorize('superadmin', 'admin'), controller.deleteBonus);

module.exports = router;
