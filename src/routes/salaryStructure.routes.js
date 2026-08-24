const express = require('express');
const router = express.Router();
const controller = require('../controllers/salaryStructure.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');

const canManage = authorize('superadmin', 'admin', 'company_admin', 'subcompany_admin');

router.get('/', authenticate, canManage, attachScope, controller.listSalaryStructures);
router.get('/:userId', authenticate, attachScope, controller.getSalaryStructure);
router.put('/:userId', authenticate, canManage, attachScope, controller.upsertSalaryStructure);
router.get('/:userId/history', authenticate, attachScope, controller.getRevisionHistory);

module.exports = router;
