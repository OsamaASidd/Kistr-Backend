const express = require('express');
const bcrypt = require('bcryptjs'); // Added missing import
const { body, validationResult, query } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Get all employees with pagination and filters
router.get('/employees', authenticateToken, [
    query('page').optional().isInt({ min: 1 }),
    query('perPage').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().isLength({ max: 255 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const offset = (page - 1) * perPage;
        const search = req.query.search || '';

        let whereClause = 'WHERE 1=1';
        let queryParams = [];
        let paramIndex = 1;

        // Add search filter
        if (search) {
            whereClause += ` AND (name LIKE $${paramIndex} OR email LIKE $${paramIndex + 1} OR position LIKE $${paramIndex + 2})`;
            const searchTerm = `%${search}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm);
            paramIndex += 3;
        }

        // Add other filters
        if (req.query.department) {
            whereClause += ` AND department = $${paramIndex}`;
            queryParams.push(req.query.department);
            paramIndex++;
        }

        if (req.query.team) {
            whereClause += ` AND team = $${paramIndex}`;
            queryParams.push(req.query.team);
            paramIndex++;
        }

        if (req.query.employee_status) {
            whereClause += ` AND employee_status = $${paramIndex}`;
            queryParams.push(req.query.employee_status);
            paramIndex++;
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const total = parseInt(countResult.rows[0].total);

        // Get paginated data
        const dataQuery = `
            SELECT id, employee_id, name, email, employee_status, employment_type, 
                   position, department, team, role, city, hired_at, weekly_hours
            FROM users 
            ${whereClause}
            ORDER BY name ASC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        const employees = await pool.query(dataQuery, [...queryParams, perPage, offset]);

        const totalPages = Math.ceil(total / perPage);

        res.json({
            body: {
                data: employees.rows,
                meta: {
                    current_page: page,
                    per_page: perPage,
                    total: total,
                    last_page: totalPages,
                    from: offset + 1,
                    to: Math.min(offset + perPage, total),
                    links: generatePaginationLinks(page, totalPages, req.originalUrl)
                }
            }
        });
    } catch (error) {
        console.error('Get employees error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get single employee
router.get('/employees/:id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE id = $1',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.json({
            body: result.rows[0]
        });
    } catch (error) {
        console.error('Get employee error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create new employee
router.post('/employees', authenticateToken, [
    body('first_name').notEmpty().trim().isLength({ max: 100 }),
    body('last_name').notEmpty().trim().isLength({ max: 100 }),
    body('email').isEmail().normalizeEmail(),
    body('employment_type').isIn(['intern', 'extern', 'internship', 'trainee', 'working_student', 'permanent']),
    body('dob').isISO8601().toDate(),
    body('position').notEmpty().trim(),
    body('department').notEmpty().trim(),
    body('team').optional().trim(),
    body('weekly_hours').isFloat({ min: 0, max: 40 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        // Generate employee ID
        const lastEmployee = await pool.query(
            'SELECT employee_id FROM users ORDER BY id DESC LIMIT 1'
        );
        
        let nextNumber = 1;
        if (lastEmployee.rows.length > 0 && lastEmployee.rows[0].employee_id) {
            const lastNumber = parseInt(lastEmployee.rows[0].employee_id.replace('EMP', ''));
            nextNumber = lastNumber + 1;
        }
        
        const employeeId = `EMP${nextNumber.toString().padStart(3, '0')}`;

        // Hash default password
        const defaultPassword = await bcrypt.hash('password', 10);

        const insertQuery = `
            INSERT INTO users (
                employee_id, email, password, first_name, last_name, dob,
                employment_type, position, department, team, reporting_manager,
                city, weekly_hours, contract_start_at, working_time_model,
                salary_type, base_salary, paid_vacation, onboarding_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            RETURNING id
        `;

        const values = [
            employeeId,
            req.body.email,
            defaultPassword,
            req.body.first_name,
            req.body.last_name,
            req.body.dob,
            req.body.employment_type,
            req.body.position,
            req.body.department,
            req.body.team || null,
            req.body.reporting_manager || null,
            req.body.city || null,
            req.body.weekly_hours,
            req.body.contract_start_at || null,
            req.body.working_time_model || null,
            req.body.salary_type || null,
            req.body.base_salary || null,
            req.body.paid_vacation || null,
            req.body.onboarding_type || null
        ];

        const result = await pool.query(insertQuery, values);

        res.status(201).json({
            message: 'Employee created successfully',
            body: {
                id: result.rows[0].id,
                employee_id: employeeId
            }
        });
    } catch (error) {
        console.error('Create employee error:', error);
        if (error.code === '23505') { // PostgreSQL unique violation
            return res.status(400).json({ message: 'Email already exists' });
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update employee
router.put('/employees/:id', authenticateToken, async (req, res) => {
    try {
        const { update_type, ...updateData } = req.body;
        
        // Build dynamic update query based on update_type
        let updateFields = [];
        let values = [];
        let paramIndex = 1;

        Object.keys(updateData).forEach(key => {
            if (key !== 'id' && updateData[key] !== undefined) {
                updateFields.push(`${key} = $${paramIndex}`);
                values.push(updateData[key]);
                paramIndex++;
            }
        });

        if (updateFields.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        values.push(req.params.id);

        const updateQuery = `
            UPDATE users 
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = $${paramIndex}
        `;

        const result = await pool.query(updateQuery, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.json({ message: 'Employee updated successfully' });
    } catch (error) {
        console.error('Update employee error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get employee filters (for filter dropdowns)
router.get('/get-employee-filters', authenticateToken, async (req, res) => {
    try {
        const departments = await pool.query(
            'SELECT DISTINCT department FROM users WHERE department IS NOT NULL ORDER BY department'
        );
        
        const teams = await pool.query(
            'SELECT DISTINCT team FROM users WHERE team IS NOT NULL ORDER BY team'
        );
        
        const statuses = await pool.query(
            'SELECT DISTINCT employee_status FROM users ORDER BY employee_status'
        );

        const filters = {
            department: Object.fromEntries(
                departments.rows.map(d => [d.department.toLowerCase().replace(/\s+/g, '_'), d.department])
            ),
            team: Object.fromEntries(
                teams.rows.map(t => [t.team.toLowerCase().replace(/\s+/g, '_'), t.team])
            ),
            employee_status: Object.fromEntries(
                statuses.rows.map(s => [s.employee_status, s.employee_status])
            )
        };

        res.json({
            body: [
                { key: 'department', label: 'Department', values: filters.department },
                { key: 'team', label: 'Team', values: filters.team },
                { key: 'employee_status', label: 'Status', values: filters.employee_status }
            ]
        });
    } catch (error) {
        console.error('Get filters error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Helper function for pagination links
function generatePaginationLinks(currentPage, totalPages, baseUrl) {
    const links = [];
    
    // Previous link
    links.push({
        url: currentPage > 1 ? `${baseUrl}?page=${currentPage - 1}` : null,
        label: '&laquo; Previous',
        active: false
    });
    
    // Page links
    for (let i = 1; i <= totalPages; i++) {
        links.push({
            url: `${baseUrl}?page=${i}`,
            label: i.toString(),
            active: i === currentPage
        });
    }
    
    // Next link
    links.push({
        url: currentPage < totalPages ? `${baseUrl}?page=${currentPage + 1}` : null,
        label: 'Next &raquo;',
        active: false
    });
    
    return links;
}

module.exports = router;