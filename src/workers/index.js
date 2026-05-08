require('dotenv').config();

const { validateEnv } = require('../config/env');
const { testConnection: testDb } = require('../config/database');
const { testConnection: testRedis } = require('../config/redis');
const logger = require('../config/logger');

validateEnv();

async function startWorkers() {
  await testDb();
  await testRedis();

  require('./analysisWorker');
  require('./gameFetchWorker');
  require('./reportWorker');
  require('./memoryWorker');

  logger.info('All Kairos workers started');
}

startWorkers().catch((err) => {
  logger.error('Worker startup failed', { error: err.message });
  process.exit(1);
});
