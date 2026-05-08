const Redis = require('ioredis');
const { config } = require('./env');
const logger = require('./logger');

let redisClient;
let subscriberClient;

function createRedisConnection(name = 'main') {
  const isTLS = config.redis.url && config.redis.url.startsWith('rediss://');

  const client = new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(isTLS && { tls: {} }),
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    reconnectOnError(err) {
      return err.message.includes('READONLY');
    },
  });

  client.on('connect', () => logger.info(`Redis [${name}] connecting`));
  client.on('ready', () => logger.info(`Redis [${name}] ready`));
  client.on('error', (err) => logger.error(`Redis [${name}] error`, { error: err.message }));
  client.on('close', () => logger.warn(`Redis [${name}] connection closed`));
  client.on('reconnecting', () => logger.info(`Redis [${name}] reconnecting`));

  return client;
}

function getRedis() {
  if (!redisClient) {
    redisClient = createRedisConnection('main');
  }
  return redisClient;
}

function getSubscriberRedis() {
  if (!subscriberClient) {
    subscriberClient = createRedisConnection('subscriber');
  }
  return subscriberClient;
}

function getBullMQConnection() {
  const url = config.redis.url;
  if (!url) throw new Error('REDIS_URL is not set');

  const parsed = new URL(url);
  const isTLS = url.startsWith('rediss://');

  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
    username: parsed.username || 'default',
    ...(isTLS && { tls: {} }),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

async function testConnection() {
  const redis = getRedis();
  await redis.ping();
  logger.info('Redis connection established');
}

module.exports = { getRedis, getSubscriberRedis, getBullMQConnection, testConnection };
