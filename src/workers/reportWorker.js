require('dotenv').config();
const { Worker } = require('bullmq');
const { getBullMQConnection } = require('../config/redis');
const { validateEnv } = require('../config/env');
const { generateWeeklyReport } = require('../services/reportService');
const logger = require('../config/logger');
const { config } = require('../config/env');

validateEnv();

const worker = new Worker(
  'kairos:report',
  async (job) => {
    const { userId, reportType } = job.data;

    logger.info('Generating report', { userId, reportType });

    let report;
    if (reportType === 'weekly') {
      report = await generateWeeklyReport(userId);
    } else {
      throw new Error(`Unsupported report type: ${reportType}`);
    }

    return { userId, reportType, gamesAnalyzed: report.games_analyzed };
  },
  {
    connection: getBullMQConnection(),
    concurrency: config.queue.concurrencyReport,
  }
);

worker.on('completed', (job, result) => {
  logger.info('Report job completed', { jobId: job.id, ...result });
});

worker.on('failed', (job, err) => {
  logger.error('Report job failed', { jobId: job.id, error: err.message });
});

logger.info('Report worker started');

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
