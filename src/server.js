require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/database');
const { logger } = require('./utils/logger');

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });
});

module.exports = app;
