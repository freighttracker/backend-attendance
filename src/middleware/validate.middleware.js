const { validationResult } = require('express-validator');
const { errorResponse } = require('../utils/responseHelper');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return errorResponse(res, 'Validation Error', 400, errors.array());
    }
    next();
};

module.exports = { validate };
