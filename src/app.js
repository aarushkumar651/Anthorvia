require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const compression = require('compression');
const { getHelmetConfig, getCorsConfig, sanitizeInput, requestId } = require('./middleware/security');
const { globalLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const routes = require('./routes');
const { config } = require('./config/env');
const logger = require('./config/logger');

const app = express();

app.set('trust proxy', 1);

app.use(getHelmetConfig());
app.use(getCorsConfig());

app.use('/api/v1/subscriptions/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(compression());
app.use(requestId);
app.use(sanitizeInput);

if (config.isProduction) {
  app.use(
    morgan('combined', {
      stream: { write: (message) => logger.info(message.trim()) },
      skip: (req) => req.url === '/api/v1/health',
    })
  );
} else {
  app.use(morgan('dev'));
}

app.use(globalLimiter);

app.use(`/api/${config.apiVersion}`, routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
