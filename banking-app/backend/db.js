const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'bankingdb',
  user: process.env.DB_USER || 'bankuser',
  password: process.env.DB_PASSWORD || 'bankpass',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});

async function connectDB() {
  let retries = 5;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      console.log('✅ PostgreSQL connected successfully');
      client.release();
      return;
    } catch (err) {
      retries--;
      console.error(`❌ DB connection failed. Retries left: ${retries}`, err.message);
      if (retries === 0) throw err;
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn('Slow query detected:', { text, duration });
  }
  return res;
}

module.exports = { pool, query, connectDB };
