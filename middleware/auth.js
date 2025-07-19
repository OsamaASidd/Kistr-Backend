const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if user still exists and is active
        const [users] = await pool.execute(
            'SELECT id, email, employee_status FROM users WHERE id = ? AND employee_status = ?',
            [decoded.userId, 'active']
        );

        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid token or user deactivated' });
        }

        req.user = users[0];
        next();
    } catch (error) {
        return res.status(403).json({ message: 'Invalid token' });
    }
};

module.exports = { authenticateToken };