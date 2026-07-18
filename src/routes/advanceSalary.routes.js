const express = require('express');
const router = express.Router();
const controller = require('../controllers/advanceSalary.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/my', authenticate, controller.getMyAdvances);
router.post('/', authenticate, controller.createAdvance);

router.get('/', authenticate, authorize('admin'), controller.getAdvances);
router.put('/:id/approve', authenticate, authorize('admin'), controller.approveAdvance);
router.put('/:id/reject', authenticate, authorize('admin'), controller.rejectAdvance);
router.put('/:id/close', authenticate, authorize('admin'), controller.closeAdvance);

module.exports = router;
