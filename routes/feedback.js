const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Get feedback list with filters
router.get('/employee-feedbacks', authenticateToken, [
    query('page').optional().isInt({ min: 1 }),
    query('per_page').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isIn(['self_feedback_request', 'other_feedback_request', 'giving_feedback'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 10;
        const offset = (page - 1) * perPage;
        const type = req.query.type;
        const userId = req.user.id;

        let whereClause = 'WHERE 1=1';
        let queryParams = [];

        // Filter by type
        if (type) {
            whereClause += ' AND f.type = ?';
            queryParams.push(type);

            // Add user-specific filters based on type
            if (type === 'self_feedback_request') {
                whereClause += ' AND f.requested_by = ?';
                queryParams.push(userId);
            } else if (type === 'other_feedback_request') {
                whereClause += ' AND f.requested_to = ?';
                queryParams.push(userId);
            } else if (type === 'giving_feedback') {
                whereClause += ' AND f.requested_by = ?';
                queryParams.push(userId);
            }
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM employee_feedbacks f ${whereClause}`;
        const [countResult] = await pool.execute(countQuery, queryParams);
        const total = countResult[0].total;

        // Get paginated data
        const dataQuery = `
            SELECT 
                f.id,
                f.requested_by,
                f.requested_to,
                f.requested_for,
                f.feedback_topic,
                f.feedback,
                f.type,
                f.status,
                f.feedback_check,
                f.created_at,
                u_to.name as requested_to_user,
                u_for.name as requested_for_user
            FROM employee_feedbacks f
            LEFT JOIN users u_to ON f.requested_to = u_to.id
            LEFT JOIN users u_for ON f.requested_for = u_for.id
            ${whereClause}
            ORDER BY f.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const [feedbacks] = await pool.execute(dataQuery, [...queryParams, perPage, offset]);

        const totalPages = Math.ceil(total / perPage);

        res.json({
            body: {
                data: feedbacks,
                meta: {
                    current_page: page,
                    per_page: perPage,
                    total: total,
                    last_page: totalPages
                }
            }
        });
    } catch (error) {
        console.error('Get feedbacks error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create new feedback request
router.post('/employee-feedbacks', authenticateToken, [
    body('type').isIn(['self_feedback_request', 'other_feedback_request', 'giving_feedback']),
    body('requested_to').optional().isInt({ min: 1 }),
    body('requested_for').optional().isInt({ min: 1 }),
    body('feedback_topic').optional().trim().isLength({ max: 1000 }),
    body('feedback').optional().trim().isLength({ max: 2000 }),
    body('feedback_check').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const userId = req.user.id;
        const { type, requested_to, requested_for, feedback_topic, feedback, feedback_check } = req.body;

        let insertData = {
            requested_by: userId,
            type: type,
            feedback_check: feedback_check || false
        };

        // Set fields based on feedback type
        if (type === 'self_feedback_request') {
            insertData.requested_to = requested_to;
            insertData.requested_for = userId;
            insertData.feedback_topic = feedback_topic;
        } else if (type === 'other_feedback_request') {
            insertData.requested_to = requested_to;
            insertData.requested_for = requested_for;
        } else if (type === 'giving_feedback') {
            insertData.requested_for = requested_for;
            insertData.feedback = feedback;
            insertData.status = 'completed';
        }

        const fields = Object.keys(insertData);
        const values = Object.values(insertData);
        const placeholders = fields.map(() => '?').join(', ');

        const insertQuery = `
            INSERT INTO employee_feedbacks (${fields.join(', ')})
            VALUES (${placeholders})
        `;

        const [result] = await pool.execute(insertQuery, values);

        res.status(201).json({
            message: 'Feedback request created successfully',
            body: {
                id: result.insertId
            }
        });
    } catch (error) {
        console.error('Create feedback error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update feedback
router.put('/employee-feedbacks/:id', authenticateToken, async (req, res) => {
    try {
        const feedbackId = req.params.id;
        const { giving_feedback_to, feedback_given, feedback_check } = req.body;

        const updateQuery = `
            UPDATE employee_feedbacks 
            SET 
                feedback = ?,
                feedback_check = ?,
                status = 'completed',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        const [result] = await pool.execute(updateQuery, [
            feedback_given,
            feedback_check || false,
            feedbackId
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Feedback not found' });
        }

        res.json({ message: 'Feedback updated successfully' });
    } catch (error) {
        console.error('Update feedback error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get feedback details
router.get('/employee-feedbacks/:id', authenticateToken, async (req, res) => {
    try {
        const feedbackId = req.params.id;

        const [feedbacks] = await pool.execute(`
            SELECT 
                f.*,
                u_by.name as requested_by_user,
                u_to.name as requested_to_user,
                u_for.name as requested_for_user
            FROM employee_feedbacks f
            LEFT JOIN users u_by ON f.requested_by = u_by.id
            LEFT JOIN users u_to ON f.requested_to = u_to.id
            LEFT JOIN users u_for ON f.requested_for = u_for.id
            WHERE f.id = ?
        `, [feedbackId]);

        if (feedbacks.length === 0) {
            return res.status(404).json({ message: 'Feedback not found' });
        }

        res.json({
            body: feedbacks[0]
        });
    } catch (error) {
        console.error('Get feedback details error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete feedback
router.delete('/employee-feedbacks/:id', authenticateToken, async (req, res) => {
    try {
        const feedbackId = req.params.id;
        const userId = req.user.id;

        // Only allow deletion by the person who created the feedback
        const [result] = await pool.execute(
            'DELETE FROM employee_feedbacks WHERE id = ? AND requested_by = ?',
            [feedbackId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Feedback not found or not authorized' });
        }

        res.json({ message: 'Feedback deleted successfully' });
    } catch (error) {
        console.error('Delete feedback error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;