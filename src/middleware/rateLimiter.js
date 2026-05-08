const rateLimit = require('express-rate-limit');
const { getRedis } = require('../config/redis');
const { config } = require('../config/env');
const { error } = require('../utils/response');

function createRedisStore(prefix) {
  const redis = getRedis();

  return {
    async increment(key) {
      const redisKey = `rl:${prefix}:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, Math.ceil(config.rateLimit.windowMs / 1000));
      }
      const ttl = await redis.ttl(redisKey);
      return {
        totalHits: count,
        resetTime: new Date(Date.now() + ttl * 1000),
      };
    },
    async decrement(key) {
      const redisKey = `rl:${prefix}:${key}`;
      await redis.decr(redisKey);
    },
    async resetKey(key) {
      const redisKey = `rl:${prefix}:${key}`;
      await redis.del(redisKey);
    },
  };
}

const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    return error(res, 'Too many requests. Please slow down.', 429);
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    return error(res, 'Too many authentication attempts. Try again in 15 minutes.', 429);
  },
});

const chatLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.chatMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    return error(res, 'Chat rate limit reached. Please wait before sending more messages.', 429);
  },
});

const analysisLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.analysisMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    return error(res, 'Analysis rate limit reached.', 429);
  },
});

module.exports = { globalLimiter, authLimiter, chatLimiter, analysisLimiter };
