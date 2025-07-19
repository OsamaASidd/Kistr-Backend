const { Pool } = require('pg');

// Determine SSL configuration based on the database URL
const getDatabaseConfig = () => {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is not set');
    }
    
    // Check if this is a Neon database (or other cloud provider that requires SSL)
    const requiresSSL = connectionString.includes('neon.tech') || 
                       connectionString.includes('amazonaws.com') ||
                       connectionString.includes('render.com') ||
                       process.env.NODE_ENV === 'production';
    
    const config = {
        connectionString: connectionString,
        ssl: false
    };
    
    if (requiresSSL) {
        config.ssl = {
            rejectUnauthorized: false // Required for most cloud PostgreSQL providers
        };
    }
    
    return config;
};

const pool = new Pool(getDatabaseConfig());

pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('PostgreSQL connection error:', err);
});

// Add a wrapper to make it compatible with MySQL syntax used in routes
pool.execute = async function(text, params) {
    return this.query(text, params);
};

module.exports = pool;