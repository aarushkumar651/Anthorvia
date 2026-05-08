const { Pool } = require('pg');
const { config } = require('./env');
const logger = require('./logger');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.db.url,
      min: config.db.poolMin,
      max: config.db.poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: config.isProduction ? { rejectUnauthorized: false } : false,
    });

    pool.on('connect', () => {
      logger.debug('New database client connected');
    });

    pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err.message });
    });
  }
  return pool;
}

async function query(text, params) {
  const start = Date.now();
  const client = getPool();
  try {
    const result = await client.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query detected', { duration, query: text.slice(0, 100) });
    }
    return result;
  } catch (err) {
    logger.error('Database query error', { error: err.message, query: text.slice(0, 100) });
    throw err;
  }
}

async function getClient() {
  return getPool().connect();
}

async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function testConnection() {
  try {
    const result = await query('SELECT NOW()');
    logger.info('Database connection established', { time: result.rows[0].now });
    return true;
  } catch (err) {
    logger.error('Database connection failed', { error: err.message });
    throw err;
  }
}

module.exports = { query, getClient, transaction, testConnection, getPool };
