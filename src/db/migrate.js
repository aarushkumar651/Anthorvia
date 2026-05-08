require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { validateEnv } = require('../config/env');
const { getPool, testConnection } = require('../config/database');
const logger = require('../config/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function getMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool) {
  const result = await pool.query('SELECT filename FROM schema_migrations ORDER BY id ASC');
  return result.rows.map((r) => r.filename);
}

async function applyMigration(pool, filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    logger.info(`Migration applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${filename} failed: ${err.message}`);
  } finally {
    client.release();
  }
}

async function migrate() {
  validateEnv();
  await testConnection();

  const pool = getPool();
  await ensureMigrationsTable(pool);

  const allMigrations = await getMigrationFiles();
  const applied = await getAppliedMigrations(pool);
  const pending = allMigrations.filter((f) => !applied.includes(f));

  if (pending.length === 0) {
    logger.info('All migrations already applied. Database is up to date.');
    process.exit(0);
  }

  logger.info(`Applying ${pending.length} pending migrations...`);

  for (const migration of pending) {
    await applyMigration(pool, migration);
  }

  logger.info('All migrations applied successfully.');
  process.exit(0);
}

migrate().catch((err) => {
  logger.error('Migration failed', { error: err.message });
  process.exit(1);
});
