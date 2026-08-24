const express = require('express');
const router = express.Router();
const controller = require('../controllers/advanceSalary.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/my', authenticate, controller.getMyAdvances);
router.post('/', authenticate, controller.createAdvance);

router.get('/', authenticate, authorize('superadmin', 'admin'), controller.getAdvances);
router.put('/:id/approve', authenticate, authorize('superadmin', 'admin'), controller.approveAdvance);
router.put('/:id/reject', authenticate, authorize('superadmin', 'admin'), controller.rejectAdvance);
router.put('/:id/close', authenticate, authorize('superadmin', 'admin'), controller.closeAdvance);

module.exports = router;
