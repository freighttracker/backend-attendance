const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');

// Company creation/management is exclusively a Super Admin capability - not
// even the legacy 'admin' role can create, edit, or (de)activate a Company.
// A Company Admin manages what's INSIDE their own company (its subcompanies,
// its users) but never touches the Company record itself.
router.get('/stats', authenticate, authorize('superadmin'), companyController.getCompanyStats);
router.get('/', authenticate, authorize('superadmin'), companyController.listCompanies);
router.post('/', authenticate, authorize('superadmin'), companyController.createCompany);
router.get('/:id', authenticate, authorize('superadmin'), companyController.getCompany);
router.put('/:id', authenticate, authorize('superadmin'), companyController.updateCompany);
router.put('/:id/status', authenticate, authorize('superadmin'), companyController.setCompanyStatus);
router.delete('/:id', authenticate, authorize('superadmin'), companyController.archiveCompany);
router.get('/:id/users', authenticate, authorize('superadmin', 'admin', 'company_admin'), attachScope, companyController.getCompanyUsers);

module.exports = router;
