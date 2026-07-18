const express = require('express');
const router = express.Router();
const controller = require('../controllers/salaryStructure.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, authorize('admin'), controller.listSalaryStructures);
router.get('/:userId', authenticate, controller.getSalaryStructure);
router.put('/:userId', authenticate, authorize('admin'), controller.upsertSalaryStructure);
router.get('/:userId/history', authenticate, controller.getRevisionHistory);

module.exports = router;
