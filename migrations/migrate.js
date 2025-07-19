const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 Starting database migration...');
        
        // Create migrations tracking table first
        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Check if migration already ran
        const migrationCheck = await client.query(
            'SELECT * FROM migrations WHERE name = $1',
            ['initial_schema']
        );

        if (migrationCheck.rows.length > 0) {
            console.log('✅ Migration already executed');
            return;
        }

        console.log('📝 Creating database schema...');

        // Execute the main schema
        await createSchema(client);
        
        // Insert sample data
        await insertSampleData(client);
        
        // Create views and functions
        await createViewsAndFunctions(client);

        // Mark migration as completed
        await client.query(
            'INSERT INTO migrations (name) VALUES ($1)',
            ['initial_schema']
        );

        console.log('✅ Migration completed successfully!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function createSchema(client) {
    const schema = `
        -- ============================================================================
        -- USERS TABLE (Main user/employee information)
        -- ============================================================================
        CREATE TABLE users (
            id BIGSERIAL PRIMARY KEY,
            employee_id VARCHAR(50) UNIQUE,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            email_verified_at TIMESTAMP NULL,
            
            -- Personal Information
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            dob DATE,
            gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other')),
            nationality VARCHAR(100),
            
            -- Contact Information
            phone VARCHAR(20),
            address TEXT,
            house_number VARCHAR(20),
            postcode VARCHAR(20),
            city VARCHAR(100),
            
            -- Employment Information
            employee_status VARCHAR(20) DEFAULT 'active' CHECK (employee_status IN ('active', 'inactive', 'terminated')),
            employment_type VARCHAR(30) NOT NULL CHECK (employment_type IN ('intern', 'extern', 'internship', 'trainee', 'working_student', 'permanent')),
            position VARCHAR(100),
            department VARCHAR(100),
            team VARCHAR(100),
            role VARCHAR(100),
            reporting_manager VARCHAR(100),
            
            -- Contract Information
            hired_at DATE,
            contract_start_at DATE,
            contract_end_at DATE,
            notice_period VARCHAR(50),
            occupation_type VARCHAR(100),
            probation_time VARCHAR(50),
            weekly_hours DECIMAL(5,2),
            onboarding_type VARCHAR(100),
            working_time_model VARCHAR(100),
            
            -- Salary Information
            salary_type VARCHAR(50),
            base_salary DECIMAL(10,2),
            paid_vacation INTEGER,
            
            -- Tax and Insurance Information
            tax_id VARCHAR(50),
            social_security_number VARCHAR(50),
            personal_income_tax_class VARCHAR(10),
            married BOOLEAN DEFAULT FALSE,
            health_insurance_type VARCHAR(100),
            insurance_name VARCHAR(100),
            child_allowance DECIMAL(8,2),
            
            -- Bank Information
            iban VARCHAR(50),
            bic VARCHAR(20),
            
            -- Emergency Contact
            emergency_person_name VARCHAR(100),
            emergency_person_contact VARCHAR(50),
            emergency_person_relation VARCHAR(50),
            
            -- Social/Professional Links
            linkedin_url VARCHAR(500),
            
            -- System fields
            remember_token VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Add computed name column
        ALTER TABLE users ADD COLUMN name VARCHAR(200) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;

        -- Create indexes for users table
        CREATE INDEX idx_users_email ON users(email);
        CREATE INDEX idx_users_employee_id ON users(employee_id);
        CREATE INDEX idx_users_employee_status ON users(employee_status);
        CREATE INDEX idx_users_department_team ON users(department, team);
        CREATE INDEX idx_users_status_department ON users(employee_status, department);
        CREATE INDEX idx_users_employment_type ON users(employment_type);

        -- ============================================================================
        -- PASSWORD RESET TOKENS
        -- ============================================================================
        CREATE TABLE password_reset_tokens (
            email VARCHAR(255) PRIMARY KEY,
            token VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_password_reset_token ON password_reset_tokens(token);

        -- ============================================================================
        -- PERSONAL ACCESS TOKENS
        -- ============================================================================
        CREATE TABLE personal_access_tokens (
            id BIGSERIAL PRIMARY KEY,
            tokenable_type VARCHAR(255) NOT NULL,
            tokenable_id BIGINT NOT NULL,
            name VARCHAR(255) NOT NULL,
            token VARCHAR(64) UNIQUE NOT NULL,
            abilities TEXT,
            last_used_at TIMESTAMP NULL,
            expires_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_personal_access_tokens_tokenable ON personal_access_tokens(tokenable_type, tokenable_id);
        CREATE INDEX idx_personal_access_tokens_token ON personal_access_tokens(token);

        -- ============================================================================
        -- EMPLOYEE CHECK-INS
        -- ============================================================================
        CREATE TABLE employee_checkins (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            checkin_date DATE NOT NULL,
            checkin_time TIME NOT NULL,
            checkout_time TIME NULL,
            status VARCHAR(20) DEFAULT 'checkin' CHECK (status IN ('checkin', 'break', 'checkout')),
            on_break BOOLEAN DEFAULT FALSE,
            
            -- Time tracking in minutes
            total_working_minutes INTEGER DEFAULT 0,
            total_break_minutes INTEGER DEFAULT 0,
            total_daily_minutes INTEGER DEFAULT 0,
            
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            UNIQUE(user_id, checkin_date)
        );

        -- Add computed time fields
        ALTER TABLE employee_checkins 
        ADD COLUMN total_working_hours VARCHAR(10) GENERATED ALWAYS AS (
            LPAD((total_working_minutes / 60)::TEXT, 2, '0') || ':' || 
            LPAD((total_working_minutes % 60)::TEXT, 2, '0')
        ) STORED;

        ALTER TABLE employee_checkins 
        ADD COLUMN total_break_hours VARCHAR(10) GENERATED ALWAYS AS (
            LPAD((total_break_minutes / 60)::TEXT, 2, '0') || ':' || 
            LPAD((total_break_minutes % 60)::TEXT, 2, '0')
        ) STORED;

        ALTER TABLE employee_checkins 
        ADD COLUMN total_daily_hours VARCHAR(10) GENERATED ALWAYS AS (
            LPAD((total_daily_minutes / 60)::TEXT, 2, '0') || ':' || 
            LPAD((total_daily_minutes % 60)::TEXT, 2, '0')
        ) STORED;

        -- Create indexes
        CREATE INDEX idx_employee_checkins_user_date ON employee_checkins(user_id, checkin_date);
        CREATE INDEX idx_employee_checkins_date ON employee_checkins(checkin_date);
        CREATE INDEX idx_employee_checkins_user_status ON employee_checkins(user_id, status);

        -- ============================================================================
        -- EMPLOYEE DOCUMENTS
        -- ============================================================================
        CREATE TABLE employee_documents (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(100) NOT NULL,
            file_path VARCHAR(500) NOT NULL,
            file_size BIGINT,
            mime_type VARCHAR(100),
            status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
            
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_employee_documents_user_type ON employee_documents(user_id, type);
        CREATE INDEX idx_employee_documents_status ON employee_documents(status);
        CREATE INDEX idx_employee_documents_user_status ON employee_documents(user_id, status);

        -- ============================================================================
        -- EMPLOYEE FEEDBACK SYSTEM
        -- ============================================================================
        CREATE TABLE employee_feedbacks (
            id BIGSERIAL PRIMARY KEY,
            
            requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            requested_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
            requested_for BIGINT REFERENCES users(id) ON DELETE SET NULL,
            
            feedback_topic TEXT,
            feedback TEXT,
            type VARCHAR(50) NOT NULL CHECK (type IN ('self_feedback_request', 'other_feedback_request', 'giving_feedback')),
            
            status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
            feedback_check BOOLEAN DEFAULT FALSE,
            
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_employee_feedbacks_requested_to ON employee_feedbacks(requested_to);
        CREATE INDEX idx_employee_feedbacks_requested_for ON employee_feedbacks(requested_for);
        CREATE INDEX idx_employee_feedbacks_type_status ON employee_feedbacks(type, status);
        CREATE INDEX idx_employee_feedbacks_status_type ON employee_feedbacks(status, type);

        -- ============================================================================
        -- FAILED JOBS
        -- ============================================================================
        CREATE TABLE failed_jobs (
            id BIGSERIAL PRIMARY KEY,
            uuid VARCHAR(255) UNIQUE NOT NULL,
            connection TEXT NOT NULL,
            queue TEXT NOT NULL,
            payload TEXT NOT NULL,
            exception TEXT NOT NULL,
            failed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_failed_jobs_uuid ON failed_jobs(uuid);

        -- ============================================================================
        -- SESSIONS
        -- ============================================================================
        CREATE TABLE sessions (
            id VARCHAR(255) PRIMARY KEY,
            user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
            ip_address INET,
            user_agent TEXT,
            payload TEXT NOT NULL,
            last_activity INTEGER NOT NULL
        );

        CREATE INDEX idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX idx_sessions_last_activity ON sessions(last_activity);

        -- ============================================================================
        -- DEPARTMENTS
        -- ============================================================================
        CREATE TABLE departments (
            id BIGSERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            description TEXT,
            manager_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- ============================================================================
        -- TEAMS
        -- ============================================================================
        CREATE TABLE teams (
            id BIGSERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            department_id BIGINT REFERENCES departments(id) ON DELETE SET NULL,
            team_lead_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            UNIQUE(name, department_id)
        );

        -- ============================================================================
        -- TRIGGERS FOR UPDATED_AT
        -- ============================================================================
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ language 'plpgsql';

        CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
            FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

        CREATE TRIGGER update_employee_checkins_updated_at BEFORE UPDATE ON employee_checkins
            FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

        CREATE TRIGGER update_employee_documents_updated_at BEFORE UPDATE ON employee_documents
            FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

        CREATE TRIGGER update_employee_feedbacks_updated_at BEFORE UPDATE ON employee_feedbacks
            FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

        CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments
            FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

        CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
            FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
    `;

    await client.query(schema);
    console.log('✅ Database schema created');
}

async function insertSampleData(client) {
    console.log('📊 Inserting sample data...');

    // Insert departments
    await client.query(`
        INSERT INTO departments (name, description) VALUES 
        ('Engineering', 'Software development and technical operations'),
        ('Human Resources', 'People operations and talent management'),
        ('Marketing', 'Brand and growth marketing'),
        ('Finance', 'Financial planning and accounting'),
        ('Operations', 'Business operations and administration')
        ON CONFLICT (name) DO NOTHING;
    `);

    // Insert teams
    await client.query(`
        INSERT INTO teams (name, department_id) VALUES 
        ('Backend Development', (SELECT id FROM departments WHERE name = 'Engineering')),
        ('Frontend Development', (SELECT id FROM departments WHERE name = 'Engineering')),
        ('DevOps', (SELECT id FROM departments WHERE name = 'Engineering')),
        ('IT Support', (SELECT id FROM departments WHERE name = 'Engineering')),
        ('Talent Acquisition', (SELECT id FROM departments WHERE name = 'Human Resources')),
        ('Employee Relations', (SELECT id FROM departments WHERE name = 'Human Resources')),
        ('Digital Marketing', (SELECT id FROM departments WHERE name = 'Marketing')),
        ('Content Marketing', (SELECT id FROM departments WHERE name = 'Marketing'))
        ON CONFLICT (name, department_id) DO NOTHING;
    `);

    // Insert admin user (password: 'password' hashed with bcrypt)
    await client.query(`
        INSERT INTO users (
            employee_id, email, password, first_name, last_name, 
            employment_type, position, department, team, role,
            employee_status, city, weekly_hours
        ) VALUES (
            'EMP001', 
            'admin@kistr.com', 
            '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
            'Wolfgang', 
            'Admin',
            'permanent', 
            'System Administrator', 
            'Engineering', 
            'IT Support', 
            'Admin',
            'active',
            'Munich',
            40.00
        ) ON CONFLICT (email) DO NOTHING;
    `);

    console.log('✅ Sample data inserted');
}

async function createViewsAndFunctions(client) {
    console.log('🔧 Creating views and functions...');

    // Create employee overview view
    await client.query(`
        CREATE OR REPLACE VIEW employee_overview AS
        SELECT 
            u.id,
            u.employee_id,
            u.name,
            u.email,
            u.employee_status,
            u.employment_type,
            u.position,
            u.department,
            u.team,
            u.role,
            u.city,
            u.hired_at,
            u.weekly_hours,
            d.name as department_name,
            t.name as team_name,
            (CURRENT_DATE - u.hired_at) as days_employed,
            (SELECT checkin_date FROM employee_checkins WHERE user_id = u.id ORDER BY checkin_date DESC LIMIT 1) as last_checkin_date
        FROM users u
        LEFT JOIN departments d ON u.department = d.name
        LEFT JOIN teams t ON u.team = t.name
        WHERE u.employee_status = 'active';
    `);

    // Create time tracking summary view
    await client.query(`
        CREATE OR REPLACE VIEW time_tracking_summary AS
        SELECT 
            u.name as employee,
            ec.checkin_date,
            ec.checkin_time,
            ec.checkout_time,
            ec.total_working_hours,
            ec.total_break_hours,
            ec.total_daily_hours,
            ec.status,
            u.weekly_hours as contracted_hours
        FROM employee_checkins ec
        JOIN users u ON ec.user_id = u.id
        ORDER BY ec.checkin_date DESC, u.name;
    `);

    // Create stored procedures
    await client.query(`
        CREATE OR REPLACE FUNCTION create_checkin(p_user_id BIGINT)
        RETURNS TABLE(checkin_id BIGINT) AS $$
        DECLARE
            current_date DATE := CURRENT_DATE;
            current_time TIME := CURRENT_TIME;
            new_id BIGINT;
        BEGIN
            INSERT INTO employee_checkins (
                user_id, 
                checkin_date, 
                checkin_time, 
                status
            ) VALUES (
                p_user_id, 
                current_date, 
                current_time, 
                'checkin'
            ) RETURNING id INTO new_id;
            
            RETURN QUERY SELECT new_id;
        END;
        $$ LANGUAGE plpgsql;
    `);

    await client.query(`
        CREATE OR REPLACE FUNCTION update_checkin_status(
            p_checkin_id BIGINT,
            p_new_status VARCHAR(20)
        )
        RETURNS VOID AS $$
        DECLARE
            current_time TIME := CURRENT_TIME;
        BEGIN
            IF p_new_status = 'checkout' THEN
                UPDATE employee_checkins 
                SET 
                    checkout_time = current_time,
                    status = p_new_status,
                    on_break = FALSE,
                    total_daily_minutes = EXTRACT(EPOCH FROM (
                        (checkin_date + current_time) - (checkin_date + checkin_time)
                    )) / 60,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = p_checkin_id;
            ELSE
                UPDATE employee_checkins 
                SET 
                    status = p_new_status,
                    on_break = (p_new_status = 'break'),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = p_checkin_id;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
    `);

    console.log('✅ Views and functions created');
}

// Run the migration
if (require.main === module) {
    runMigrations()
        .then(() => {
            console.log('🎉 Database setup complete!');
            process.exit(0);
        })
        .catch(error => {
            console.error('💥 Migration failed:', error);
            process.exit(1);
        });
}

module.exports = { runMigrations };