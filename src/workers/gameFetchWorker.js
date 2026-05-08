require('dotenv').config();
const { Worker } = require('bullmq');
const { getBullMQConnection } = require('../config/redis');
const { validateEnv } = require('../config/env');
const { testConnection } = require('../config/database');
const { fetchAndStoreGames, getLatestGameTimestamp } = require('../services/gameFetcher');
const logger = require('../config/logger');
const { config } = require('../config/env');

validateEnv();

const worker = new Worker(
  'kairos:game-fetch',
  async (job) => {
    const { userId, platform, forceRefresh = false } = job.data;

    logger.info('Fetching games', { userId, platform });

    await job.updateProgress(10);

    const sinceTimestamp = forceRefresh
      ? null
      : await getLatestGameTimestamp(userId, platform);

    await job.updateProgress(20);

    const result = await fetchAndStoreGames(userId, platform, {
      sinceTimestamp,
      analyzeImmediately: true,
    });

    await job.updateProgress(100);

    logger.info('Game fetch complete', { userId, platform, ...result });

    return result;
  },
  {
    connection: getBullMQConnection(),
    concurrency: config.queue.concurrencyFetch,
  }
);

worker.on('completed', (job, result) => {
  logger.info('Game fetch completed', { jobId: job.id, ...result });
});

worker.on('failed', (job, err) => {
  logger.error('Game fetch failed', { jobId: job.id, error: err.message, data: job.data });
});

worker.on('error', (err) => {
  logger.error('Game fetch worker error', { error: err.message });
});

logger.info('Game fetch worker started');

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
