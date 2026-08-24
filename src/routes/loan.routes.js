const express = require('express');
const router = express.Router();
const controller = require('../controllers/loan.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/my', authenticate, controller.getMyLoans);
router.post('/', authenticate, controller.createLoan);

router.get('/', authenticate, authorize('superadmin', 'admin'), controller.getLoans);
router.get('/:id', authenticate, controller.getLoan);
router.put('/:id/approve', authenticate, authorize('superadmin', 'admin'), controller.approveLoan);
router.put('/:id/reject', authenticate, authorize('superadmin', 'admin'), controller.rejectLoan);
router.put('/:id/close', authenticate, authorize('superadmin', 'admin'), controller.closeLoan);

module.exports = router;
