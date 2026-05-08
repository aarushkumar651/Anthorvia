const jwt = require('jsonwebtoken');
const { config } = require('../config/env');
const { query } = require('../config/database');
const { unauthorized } = require('../utils/response');
const logger = require('../config/logger');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return unauthorized(res, 'Authorization header missing or malformed');
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    const result = await query(
      `SELECT id, email, name, chess_com_username, lichess_username,
              preferred_platform, coach_personality, onboarding_complete,
              created_at
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return unauthorized(res, 'User not found');
    }

    const subResult = await query(
      `SELECT plan, status, trial_end, current_period_end
       FROM subscriptions WHERE user_id = $1`,
      [decoded.userId]
    );

    const user = result.rows[0];
    const subscription = subResult.rows[0] || { plan: 'free', status: 'expired' };

    const now = new Date();
    if (
      subscription.status === 'trialing' &&
      new Date(subscription.trial_end) < now
    ) {
      await query(
        `UPDATE subscriptions SET status = 'expired' WHERE user_id = $1`,
        [user.id]
      );
      subscription.status = 'expired';
    }

    req.user = {
      ...user,
      plan: subscription.plan,
      subscriptionStatus: subscription.status,
      trialEnd: subscription.trial_end,
      periodEnd: subscription.current_period_end,
      isActive:
        subscription.status === 'trialing' ||
        subscription.status === 'active',
    };

    await query(`UPDATE users SET last_active_at = NOW() WHERE id = $1`, [user.id]);

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return unauthorized(res, 'Token expired');
    }
    if (err.name === 'JsonWebTokenError') {
      return unauthorized(res, 'Invalid token');
    }
    logger.error('Auth middleware error', { error: err.message });
    return unauthorized(res, 'Authentication failed');
  }
}

async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  return authenticate(req, res, next);
}

module.exports = { authenticate, optionalAuth };
