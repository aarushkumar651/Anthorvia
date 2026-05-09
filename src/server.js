require('dotenv').config();
const { validateEnv } = require('./config/env');
const { testConnection: testDb } = require('./config/database');
const { testConnection: testRedis } = require('./config/redis');
const logger = require('./config/logger');
const app = require('./app');
const { config } = require('./config/env');
const { initVoiceWebSocket } = require('./voice/websocket');

async function bootstrap() {
  validateEnv();

  logger.info('Kairos API starting...', { env: config.env });

  try {
    await testDb();
  } catch (err) {
    logger.warn('DB connection failed on startup', { error: err.message });
  }

  try {
    await testRedis();
  } catch (err) {
    logger.warn('Redis connection failed on startup', { error: err.message });
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Kairos API listening`, {
      port: config.port,
      env: config.env,
      version: config.apiVersion,
    });
  });

  initVoiceWebSocket(server);

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const shutdown = async (signal) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err.message);
  process.exit(1);
});
