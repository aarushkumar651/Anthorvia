require('dotenv').config();
const { Worker } = require('bullmq');
const { getBullMQConnection } = require('../config/redis');
const { validateEnv } = require('../config/env');
const { extractAndStoreMemories } = require('../services/memoryService');
const logger = require('../config/logger');
const { config } = require('../config/env');

validateEnv();

const worker = new Worker(
  'kairos:memory',
  async (job) => {
    const { userId, userMessage, aiResponse, sessionId } = job.data;

    await extractAndStoreMemories(userId, userMessage, aiResponse);

    return { userId, sessionId };
  },
  {
    connection: getBullMQConnection(),
    concurrency: config.queue.concurrencyMemory,
  }
);

worker.on('failed', (job, err) => {
  logger.debug('Memory job failed (non-critical)', { jobId: job.id, error: err.message });
});

worker.on('error', (err) => {
  logger.error('Memory worker error', { error: err.message });
});

logger.info('Memory worker started');

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
