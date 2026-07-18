const express = require('express');
const router = express.Router();
const controller = require('../controllers/loan.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/my', authenticate, controller.getMyLoans);
router.post('/', authenticate, controller.createLoan);

router.get('/', authenticate, authorize('admin'), controller.getLoans);
router.get('/:id', authenticate, controller.getLoan);
router.put('/:id/approve', authenticate, authorize('admin'), controller.approveLoan);
router.put('/:id/reject', authenticate, authorize('admin'), controller.rejectLoan);
router.put('/:id/close', authenticate, authorize('admin'), controller.closeLoan);

module.exports = router;
