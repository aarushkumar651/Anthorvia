const { Queue } = require('bullmq');
const { getBullMQConnection } = require('../config/redis');
const logger = require('../config/logger');

const connection = getBullMQConnection();

const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 3000,
  },
};

const analysisQueue = new Queue('kairos-analysis', {
  connection,
  defaultJobOptions,
});

const gameFetchQueue = new Queue('kairos-game-fetch', {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

const reportQueue = new Queue('kairos-report', {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 2,
  },
});

const memoryQueue = new Queue('kairos-memory', {
  connection,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 2,
    removeOnComplete: { count: 50 },
  },
});

async function addAnalysisJob(gameId, userId, plan, priority = 0) {
  const job = await analysisQueue.add(
    'analyze-game',
    { gameId, userId, plan },
    {
      priority: plan === 'pro' ? 10 : plan === 'basic' ? 5 : 0,
      jobId: `analysis-${gameId}`,
    }
  );
  logger.debug('Analysis job added', { jobId: job.id, gameId });
  return job;
}

async function addGameFetchJob(userId, platform, options = {}) {
  const job = await gameFetchQueue.add(
    'fetch-games',
    { userId, platform, ...options },
    {
      jobId: `fetch-${userId}-${platform}`,
    }
  );
  logger.debug('Game fetch job added', { jobId: job.id, userId, platform });
  return job;
}

async function addReportJob(userId, reportType, options = {}) {
  const job = await reportQueue.add('generate-report', { userId, reportType, ...options });
  logger.debug('Report job added', { jobId: job.id, userId, reportType });
  return job;
}

async function addMemoryJob(userId, userMessage, aiResponse, sessionId) {
  const job = await memoryQueue.add('extract-memories', {
    userId,
    userMessage,
    aiResponse,
    sessionId,
  });
  return job;
}

async function getQueueStats() {
  const [analysisStats, fetchStats, reportStats, memoryStats] = await Promise.all([
    analysisQueue.getJobCounts(),
    gameFetchQueue.getJobCounts(),
    reportQueue.getJobCounts(),
    memoryQueue.getJobCounts(),
  ]);

  return {
    analysis: analysisStats,
    gameFetch: fetchStats,
    report: reportStats,
    memory: memoryStats,
  };
}

module.exports = {
  analysisQueue,
  gameFetchQueue,
  reportQueue,
  memoryQueue,
  addAnalysisJob,
  addGameFetchJob,
  addReportJob,
  addMemoryJob,
  getQueueStats,
};
