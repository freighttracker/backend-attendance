const express = require('express');
const router = express.Router();
const controller = require('../controllers/reimbursement.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

router.get('/my', authenticate, controller.getMyReimbursements);
router.post('/', authenticate, upload.single('file'), controller.createReimbursement);

router.get('/', authenticate, authorize('admin'), controller.getReimbursements);
router.put('/:id/approve', authenticate, authorize('admin'), controller.approveReimbursement);
router.put('/:id/reject', authenticate, authorize('admin'), controller.rejectReimbursement);
router.delete('/:id', authenticate, authorize('admin'), controller.deleteReimbursement);

module.exports = router;
