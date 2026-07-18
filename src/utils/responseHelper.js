const successResponse = (res, data = null, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
        timestamp: new Date().toISOString()
    });
};

const errorResponse = (res, message = 'Error occurred', statusCode = 400, errors = null) => {
    const response = {
        success: false,
        message,
        timestamp: new Date().toISOString()
    };
    if (errors) response.errors = errors;
    return res.status(statusCode).json(response);
};

const paginatedResponse = (res, data, pagination, message = 'Success') => {
    return res.status(200).json({
        success: true,
        message,
        data,
        pagination,
        timestamp: new Date().toISOString()
    });
};

module.exports = { successResponse, errorResponse, paginatedResponse };
