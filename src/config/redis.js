const Redis = require('ioredis');
const { config } = require('./env');
const logger = require('./logger');

let redisClient;
let subscriberClient;

function createRedisConnection(name = 'main') {
  const client = new Redis(config.redis.url, {
    password: config.redis.password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
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
  return {
    host: new URL(config.redis.url).hostname,
    port: parseInt(new URL(config.redis.url).port || '6379', 10),
    password: config.redis.password,
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
