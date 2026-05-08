const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { getRedis } = require('../config/redis');
const { getQueueStats } = require('../queues');
const { success, error } = require('../utils/response');

router.get('/', async (req, res) => {
  return success(res, { status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/detailed', async (req, res) => {
  const checks = {};

  try {
    await query('SELECT 1');
    checks.database = 'healthy';
  } catch {
    checks.database = 'unhealthy';
  }

  try {
    await getRedis().ping();
    checks.redis = 'healthy';
  } catch {
    checks.redis = 'unhealthy';
  }

  try {
    const queueStats = await getQueueStats();
    checks.queues = { status: 'healthy', stats: queueStats };
  } catch {
    checks.queues = { status: 'unhealthy' };
  }

  const allHealthy = Object.values(checks).every(
    (v) => v === 'healthy' || (typeof v === 'object' && v.status === 'healthy')
  );

  if (!allHealthy) {
    return res.status(503).json({
      success: false,
      status: 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  }

  return success(res, {
    status: 'healthy',
    version: process.env.npm_package_version || '1.0.0',
    uptime: Math.floor(process.uptime()),
    checks,
  });
});

module.exports = router;
