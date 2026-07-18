const jwt = require('jsonwebtoken');

const tokenFor = (user) => jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

module.exports = { tokenFor };
