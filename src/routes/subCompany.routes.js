const express = require('express');
const router = express.Router();
const subCompanyController = require('../controllers/subCompany.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');

// Subcompanies are manageable by superadmin/admin (any) or a Company Admin
// (their own company only, enforced in the controller via req.scope).
const canManage = authorize('superadmin', 'admin', 'company_admin');

router.get('/', authenticate, canManage, attachScope, subCompanyController.listSubCompanies);
router.post('/', authenticate, canManage, attachScope, subCompanyController.createSubCompany);
router.get('/:id', authenticate, authorize('superadmin', 'admin', 'company_admin', 'subcompany_admin'), attachScope, subCompanyController.getSubCompany);
router.put('/:id', authenticate, canManage, attachScope, subCompanyController.updateSubCompany);
router.put('/:id/status', authenticate, canManage, attachScope, subCompanyController.setSubCompanyStatus);
router.delete('/:id', authenticate, canManage, attachScope, subCompanyController.archiveSubCompany);
router.get('/:id/users', authenticate, authorize('superadmin', 'admin', 'company_admin', 'subcompany_admin'), attachScope, subCompanyController.getSubCompanyUsers);

module.exports = router;
