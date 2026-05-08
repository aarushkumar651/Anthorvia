const helmet = require('helmet');
const cors = require('cors');
const xss = require('xss');
const { config } = require('../config/env');

function getHelmetConfig() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}

function getCorsConfig() {
  const allowedOrigins = [
    config.frontendUrl,
    'http://localhost:3000',
    'http://localhost:19006',
    'exp://',
  ].filter(Boolean);

  return cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.some((allowed) => origin.startsWith(allowed)) ||
        origin.startsWith('kairos://')
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy violation: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  });
}

function sanitizeInput(req, res, next) {
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      return xss(value.trim(), {
        whiteList: {},
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script'],
      });
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const sanitized = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = sanitizeValue(val);
      }
      return sanitized;
    }
    if (Array.isArray(value)) {
      return value.map(sanitizeValue);
    }
    return value;
  };

  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeValue(req.query);
  }

  next();
}

function requestId(req, res, next) {
  const { v4: uuidv4 } = require('uuid');
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

module.exports = { getHelmetConfig, getCorsConfig, sanitizeInput, requestId };
