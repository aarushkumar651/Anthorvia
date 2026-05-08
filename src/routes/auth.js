const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate, schemas } = require('../middleware/validate');
const { success, created, error } = require('../utils/response');

router.post('/register', authLimiter, validate(schemas.register), async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    const { user, tokens } = await authService.register(email, password, name);

    return created(res, {
      user: { id: user.id, email: user.email, name: user.name },
      tokens,
    }, 'Account created successfully');
  } catch (err) {
    if (err.statusCode === 409) return error(res, err.message, 409);
    next(err);
  }
});

router.post('/login', authLimiter, validate(schemas.login), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const deviceInfo = req.headers['x-device-info'] || req.headers['user-agent'];
    const ipAddress = req.ip;

    const { user, tokens } = await authService.login(email, password, deviceInfo, ipAddress);

    return success(res, { user, tokens }, 'Login successful');
  } catch (err) {
    if (err.statusCode === 401) return error(res, err.message, 401);
    if (err.statusCode === 400) return error(res, err.message, 400);
    next(err);
  }
});

router.post('/refresh', validate(schemas.refreshToken), async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    const tokens = await authService.refreshTokens(refresh_token);
    return success(res, { tokens }, 'Tokens refreshed');
  } catch (err) {
    if (err.statusCode === 401) return error(res, err.message, 401);
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await authService.revokeRefreshToken(refresh_token);
    }
    return success(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
});

router.post('/logout-all', authenticate, async (req, res, next) => {
  try {
    await authService.revokeAllUserTokens(req.user.id);
    return success(res, null, 'Logged out from all devices');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
