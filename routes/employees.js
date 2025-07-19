const express = require('express');
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

        // Add search filter
        if (search) {
            whereClause += ' AND (name LIKE ? OR email LIKE ? OR position LIKE ?)';
            const searchTerm = `%${search}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm);
        }

        // Add other filters
        if (req.query.department) {
            whereClause += ' AND department = ?';
            queryParams.push(req.query.department);
        }

        if (req.query.team) {
            whereClause += ' AND team = ?';
            queryParams.push(req.query.team);
        }

        if (req.query.employee_status) {
            whereClause += ' AND employee_status = ?';
            queryParams.push(req.query.employee_status);
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
        const [countResult] = await pool.execute(countQuery, queryParams);
        const total = countResult[0].total;

        // Get paginated data
        const dataQuery = `
            SELECT id, employee_id, name, email, employee_status, employment_type, 
                   position, department, team, role, city, hired_at, weekly_hours
            FROM users 
            ${whereClause}
            ORDER BY name ASC
            LIMIT ? OFFSET ?
        `;
        
        const [employees] = await pool.execute(dataQuery, [...queryParams, perPage, offset]);

        const totalPages = Math.ceil(total / perPage);

        res.json({
            body: {
                data: employees,
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
        const [employees] = await pool.execute(
            'SELECT * FROM users WHERE id = ?',
            [req.params.id]
        );

        if (employees.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.json({
            body: employees[0]
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
        const [lastEmployee] = await pool.execute(
            'SELECT employee_id FROM users ORDER BY id DESC LIMIT 1'
        );
        
        let nextNumber = 1;
        if (lastEmployee.length > 0 && lastEmployee[0].employee_id) {
            const lastNumber = parseInt(lastEmployee[0].employee_id.replace('EMP', ''));
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

        const [result] = await pool.execute(insertQuery, values);

        res.status(201).json({
            message: 'Employee created successfully',
            body: {
                id: result.insertId,
                employee_id: employeeId
            }
        });
    } catch (error) {
        console.error('Create employee error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
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

        Object.keys(updateData).forEach(key => {
            if (key !== 'id' && updateData[key] !== undefined) {
                updateFields.push(`${key} = ?`);
                values.push(updateData[key]);
            }
        });

        if (updateFields.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        values.push(req.params.id);

        const updateQuery = `
            UPDATE users 
            SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;

        const [result] = await pool.execute(updateQuery, values);

        if (result.affectedRows === 0) {
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
        const [departments] = await pool.execute(
            'SELECT DISTINCT department FROM users WHERE department IS NOT NULL ORDER BY department'
        );
        
        const [teams] = await pool.execute(
            'SELECT DISTINCT team FROM users WHERE team IS NOT NULL ORDER BY team'
        );
        
        const [statuses] = await pool.execute(
            'SELECT DISTINCT employee_status FROM users ORDER BY employee_status'
        );

        const filters = {
            department: Object.fromEntries(
                departments.map(d => [d.department.toLowerCase().replace(/\s+/g, '_'), d.department])
            ),
            team: Object.fromEntries(
                teams.map(t => [t.team.toLowerCase().replace(/\s+/g, '_'), t.team])
            ),
            employee_status: Object.fromEntries(
                statuses.map(s => [s.employee_status, s.employee_status])
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