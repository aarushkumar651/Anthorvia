require('dotenv').config();
const { validateEnv } = require('./config/env');
const { testConnection: testDb } = require('./config/database');
const { testConnection: testRedis } = require('./config/redis');
const logger = require('./config/logger');
const app = require('./app');
const { config } = require('./config/env');

async function bootstrap() {
  validateEnv();

  logger.info('Kairos API starting...', { env: config.env });

  await testDb();
  await testRedis();

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Kairos API listening`, {
      port: config.port,
      env: config.env,
      version: config.apiVersion,
    });
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const shutdown = async (signal) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      logger.info('HTTP server closed');
      const { getPool } = require('./config/database');
      const { getRedis } = require('./config/redis');

      try {
        await getPool().end();
        logger.info('Database pool closed');
      } catch {}

      try {
        await getRedis().quit();
        logger.info('Redis connection closed');
      } catch {}

      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forceful shutdown after timeout');
      process.exit(1);
    }, 15000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err.message);
  process.exit(1);
});
