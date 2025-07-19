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
        const result = await pool.query(
            'SELECT id, email, employee_status FROM users WHERE id = $1 AND employee_status = $2',
            [decoded.userId, 'active']
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid token or user deactivated' });
        }

        req.user = result.rows[0];
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(403).json({ message: 'Invalid token' });
    }
};

module.exports = { authenticateToken };