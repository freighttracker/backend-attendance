const express = require('express');
const router = express.Router();
const controller = require('../controllers/bonus.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/my', authenticate, controller.getMyBonuses);

router.get('/', authenticate, authorize('admin'), controller.getBonuses);
router.post('/', authenticate, authorize('admin'), controller.createBonus);
router.put('/:id/approve', authenticate, authorize('admin'), controller.approveBonus);
router.put('/:id/reject', authenticate, authorize('admin'), controller.rejectBonus);
router.delete('/:id', authenticate, authorize('admin'), controller.deleteBonus);

module.exports = router;
