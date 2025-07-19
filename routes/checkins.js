const express = require('express');
const { query, param } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Get check-in history with pagination
router.get('/employee-checkins', authenticateToken, [
    query('page').optional().isInt({ min: 1 }),
    query('per_page').optional().isInt({ min: 1, max: 100 }),
    query('user_id').optional().isInt({ min: 1 })
], async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 10;
        const offset = (page - 1) * perPage;
        const userId = req.query.user_id;

        let whereClause = 'WHERE 1=1';
        let queryParams = [];
        let paramIndex = 1;

        if (userId) {
            whereClause += ` AND ec.user_id = $${paramIndex}`;
            queryParams.push(userId);
            paramIndex++;
        }

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM employee_checkins ec 
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total);

        // Get paginated data with employee names
        const dataQuery = `
            SELECT 
                ec.id,
                ec.user_id,
                u.name as employee,
                ec.checkin_date,
                ec.checkin_time,
                ec.checkout_time,
                ec.status,
                ec.on_break,
                ec.total_working_hours,
                ec.total_break_hours,
                ec.total_daily_hours,
                ec.created_at
            FROM employee_checkins ec
            JOIN users u ON ec.user_id = u.id
            ${whereClause}
            ORDER BY ec.checkin_date DESC, ec.checkin_time DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        const checkins = await pool.query(dataQuery, [...queryParams, perPage, offset]);

        const totalPages = Math.ceil(total / perPage);

        res.json({
            body: {
                data: checkins.rows,
                meta: {
                    current_page: page,
                    per_page: perPage,
                    total: total,
                    last_page: totalPages
                }
            }
        });
    } catch (error) {
        console.error('Get checkins error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create new check-in
router.post('/employee-checkins', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        // Check if user already has a check-in for today
        const existingCheckin = await pool.query(
            'SELECT id FROM employee_checkins WHERE user_id = $1 AND checkin_date = $2',
            [userId, today]
        );

        if (existingCheckin.rows.length > 0) {
            return res.status(400).json({ 
                message: 'You have already checked in today' 
            });
        }

        // Create new check-in using function
        const result = await pool.query('SELECT * FROM create_checkin($1)', [userId]);
        const checkinId = result.rows[0].checkin_id;

        res.status(201).json({
            message: 'Check-in successful',
            body: {
                id: checkinId,
                checkin_date: today,
                checkin_time: new Date().toTimeString().split(' ')[0]
            }
        });
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update check-in status (break/checkout)
router.put('/employee-checkins/:id', authenticateToken, async (req, res) => {
    try {
        const checkinId = req.params.id;
        const { type } = req.body;

        if (!['break', 'checkin', 'checkout'].includes(type)) {
            return res.status(400).json({ message: 'Invalid status type' });
        }

        // Use function to update checkin status
        await pool.query('SELECT update_checkin_status($1, $2)', [checkinId, type]);

        let message = '';
        switch (type) {
            case 'break':
                message = 'Break started';
                break;
            case 'checkin':
                message = 'Back to work';
                break;
            case 'checkout':
                message = 'Checked out successfully';
                break;
        }

        res.json({ message });
    } catch (error) {
        console.error('Update checkin error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get current user's check-in history
router.get('/get-employee-checkin', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const checkins = await pool.query(`
            SELECT 
                checkin_date,
                checkin_time,
                checkout_time,
                total_working_hours,
                total_break_hours,
                total_daily_hours,
                status
            FROM employee_checkins 
            WHERE user_id = $1
            ORDER BY checkin_date DESC
            LIMIT 30
        `, [userId]);

        res.json({
            body: {
                data: checkins.rows
            }
        });
    } catch (error) {
        console.error('Get user checkin history error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;