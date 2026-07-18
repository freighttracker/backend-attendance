const express = require('express');
const router = express.Router();
const salaryFieldController = require('../controllers/salaryField.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/', authenticate, salaryFieldController.getSalaryFields);
router.put('/reorder', authenticate, authorize('admin'), salaryFieldController.reorderSalaryFields);
router.get('/:id', authenticate, salaryFieldController.getSalaryField);
router.post('/', authenticate, authorize('admin'), salaryFieldController.createSalaryField);
router.put('/:id', authenticate, authorize('admin'), salaryFieldController.updateSalaryField);
router.delete('/:id', authenticate, authorize('admin'), salaryFieldController.deleteSalaryField);

module.exports = router;
