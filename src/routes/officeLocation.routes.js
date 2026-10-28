const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const officeLocationController = require('../controllers/officeLocation.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { attachScope } = require('../middleware/scope.middleware');
const { validate } = require('../middleware/validate.middleware');
const { requireGeoPermission, PERMISSION_FLAGS } = require('../services/geoAccess.service');

const anyAdmin = authorize('superadmin', 'admin', 'company_admin', 'subcompany_admin');
const permissionManagers = authorize('superadmin', 'admin', 'company_admin');
const canManageOffices = requireGeoPermission('canManageOffices');

// Seeing the office list is needed by anyone who manages assignments or
// monitors locations, not only by office managers.   
const canSeeOffices = requireGeoPermission(...PERMISSION_FLAGS);

const officeId = param('id').isMongoId().withMessage('Invalid office id');

const officeBody = (isCreate) => {
    const req = (chain) => (isCreate ? chain : chain.optional());
    return [
        req(body('name')).isString().trim().isLength({ min: 1, max: 120 }).withMessage('Office name is required (max 120 characters)'),
        req(body('address')).isString().trim().isLength({ min: 1, max: 500 }).withMessage('Address is required (max 500 characters)'),
        req(body('latitude')).isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90').toFloat(),
        req(body('longitude')).isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180').toFloat(),
        body('radiusMeters').optional().isInt({ min: 10, max: 5000 }).withMessage('Geofence radius must be 10-5000 metres').toInt(),
        body('maxAccuracyMeters').optional({ values: 'null' }).isInt({ min: 5, max: 2000 }).withMessage('Maximum GPS accuracy must be 5-2000 metres').toInt(),
        body('code').optional({ values: 'falsy' }).isString().trim().isLength({ max: 30 }).matches(/^[A-Za-z0-9_-]+$/).withMessage('Office code may contain letters, digits, - and _ only (max 30)'),
        body('allowCheckIn').optional().isBoolean().withMessage('allowCheckIn must be true or false').toBoolean(),
        body('allowCheckOut').optional().isBoolean().withMessage('allowCheckOut must be true or false').toBoolean(),
        body('companyId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid companyId'),
        body('subCompanyId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid subCompanyId')
    ];
};

router.use(authenticate, anyAdmin, attachScope);

// Static paths first so they never match '/:id'.
router.get('/my-permissions', officeLocationController.getMyPermissions);
router.get('/admin-permissions', permissionManagers, officeLocationController.listAdminPermissions);
router.put(
    '/admin-permissions/:userId',
    permissionManagers,
    param('userId').isMongoId().withMessage('Invalid user id'),
    body('offices').optional().isArray({ max: 200 }).withMessage('offices must be an array'),
    body('offices.*').isMongoId().withMessage('Invalid office id'),
    ...PERMISSION_FLAGS.map((flag) => body(flag).optional().isBoolean().withMessage(`${flag} must be true or false`).toBoolean()),
    validate,
    officeLocationController.setAdminPermission
);

router.delete('/admin-permissions/:userId', permissionManagers, param('userId').isMongoId(), validate, officeLocationController.resetAdminPermission);

router.get(
    '/',
    canSeeOffices,
    query('isActive').optional({ values: 'falsy' }).isIn(['true', 'false']).withMessage('isActive must be true or false'),
    validate,
    officeLocationController.listOffices
);

router.post('/', canManageOffices, ...officeBody(true), validate, officeLocationController.createOffice);
router.get('/:id', canSeeOffices, officeId, validate, officeLocationController.getOffice);
router.put('/:id', canManageOffices, officeId, ...officeBody(false), validate, officeLocationController.updateOffice);
router.put(
    '/:id/status',
    canManageOffices,
    officeId,
    body('isActive').isBoolean().withMessage('isActive must be true or false').toBoolean(),
    validate,
    officeLocationController.setOfficeStatus
);

module.exports = router;
