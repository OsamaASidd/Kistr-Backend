const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = './uploads/documents';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    // Accept only PDF and DOC files
    const allowedTypes = ['application/pdf', 'application/msword', 
                         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF and DOC files are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 30 * 1024 * 1024 // 30MB limit
    },
    fileFilter: fileFilter
});

// Get employee documents
router.get('/employee-docs', authenticateToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.per_page) || 10;
        const offset = (page - 1) * perPage;
        const userId = req.query.user_id;

        let whereClause = 'WHERE 1=1';
        let queryParams = [];

        if (userId) {
            whereClause += ' AND ed.user_id = ?';
            queryParams.push(userId);
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM employee_documents ed ${whereClause}`;
        const [countResult] = await pool.execute(countQuery, queryParams);
        const total = countResult[0].total;

        // Get paginated data
        const dataQuery = `
            SELECT 
                ed.id,
                ed.user_id,
                ed.name,
                ed.type,
                ed.file_path as path,
                ed.file_size,
                ed.status,
                ed.created_at,
                u.name as employee
            FROM employee_documents ed
            JOIN users u ON ed.user_id = u.id
            ${whereClause}
            ORDER BY ed.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const [documents] = await pool.execute(dataQuery, [...queryParams, perPage, offset]);

        const totalPages = Math.ceil(total / perPage);

        res.json({
            body: {
                data: documents,
                meta: {
                    current_page: page,
                    per_page: perPage,
                    total: total,
                    last_page: totalPages
                }
            }
        });
    } catch (error) {
        console.error('Get documents error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Upload new document
router.post('/employee-docs', authenticateToken, upload.single('file'), [
    body('user_id').isInt({ min: 1 }),
    body('type').notEmpty().trim().isLength({ max: 100 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // Clean up uploaded file if validation fails
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'File is required' });
        }

        const { user_id, type } = req.body;

        const insertQuery = `
            INSERT INTO employee_documents (user_id, name, type, file_path, file_size, mime_type, status)
            VALUES (?, ?, ?, ?, ?, ?, 'active')
        `;

        const values = [
            user_id,
            req.file.originalname,
            type,
            req.file.path,
            req.file.size,
            req.file.mimetype
        ];

        const [result] = await pool.execute(insertQuery, values);

        res.status(201).json({
            message: 'Document uploaded successfully',
            body: {
                id: result.insertId
            }
        });
    } catch (error) {
        console.error('Upload document error:', error);
        // Clean up uploaded file on error
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update document
router.post('/employee-docs/:id', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        const documentId = req.params.id;
        const { user_id, type, status } = req.body;

        // Get current document info
        const [currentDoc] = await pool.execute(
            'SELECT file_path FROM employee_documents WHERE id = ?',
            [documentId]
        );

        if (currentDoc.length === 0) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(404).json({ message: 'Document not found' });
        }

        let updateFields = [];
        let values = [];

        if (user_id) {
            updateFields.push('user_id = ?');
            values.push(user_id);
        }

        if (type) {
            updateFields.push('type = ?');
            values.push(type);
        }

        if (status) {
            updateFields.push('status = ?');
            values.push(status);
        }

        if (req.file) {
            // Delete old file
            if (fs.existsSync(currentDoc[0].file_path)) {
                fs.unlinkSync(currentDoc[0].file_path);
            }

            updateFields.push('name = ?', 'file_path = ?', 'file_size = ?', 'mime_type = ?');
            values.push(req.file.originalname, req.file.path, req.file.size, req.file.mimetype);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(documentId);

        const updateQuery = `
            UPDATE employee_documents 
            SET ${updateFields.join(', ')}
            WHERE id = ?
        `;

        await pool.execute(updateQuery, values);

        res.json({ message: 'Document updated successfully' });
    } catch (error) {
        console.error('Update document error:', error);
        if (req.file) fs.unlinkSync(req.file.path);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete document
router.delete('/employee-docs/:id', authenticateToken, async (req, res) => {
    try {
        const documentId = req.params.id;

        // Get document file path before deletion
        const [document] = await pool.execute(
            'SELECT file_path FROM employee_documents WHERE id = ?',
            [documentId]
        );

        if (document.length === 0) {
            return res.status(404).json({ message: 'Document not found' });
        }

        // Delete from database
        await pool.execute('DELETE FROM employee_documents WHERE id = ?', [documentId]);

        // Delete physical file
        if (fs.existsSync(document[0].file_path)) {
            fs.unlinkSync(document[0].file_path);
        }

        res.json({ message: 'Document deleted successfully' });
    } catch (error) {
        console.error('Delete document error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;