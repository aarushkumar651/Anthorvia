const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../config/database');
const { config } = require('../config/env');
const {
  hashPassword,
  comparePassword,
  generateTokenHash,
  generateSecureToken,
} = require('../utils/crypto');
const logger = require('../config/logger');

async function register(email, password, name) {
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    const err = new Error('Email already registered');
    err.statusCode = 409;
    throw err;
  }

  const passwordHash = await hashPassword(password);

  return transaction(async (client) => {
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, created_at`,
      [email, passwordHash, name]
    );

    const user = userResult.rows[0];

    logger.info('New user registered', { userId: user.id, email: user.email });

    const tokens = await generateTokenPair(user.id, null, null);
    await storeRefreshToken(client, user.id, tokens.refreshToken, null, null);

    return { user, tokens };
  });
}

async function login(email, password, deviceInfo = null, ipAddress = null) {
  const result = await query(
    `SELECT id, email, name, password_hash, onboarding_complete
     FROM users WHERE email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  const user = result.rows[0];

  if (!user.password_hash) {
    const err = new Error('Account uses social login. Please sign in with Google.');
    err.statusCode = 400;
    throw err;
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    const err = new Error('Invalid email or password');
    err.statusCode = 401;
    throw err;
  }

  return transaction(async (client) => {
    const tokens = await generateTokenPair(user.id, deviceInfo, ipAddress);
    await storeRefreshToken(client, user.id, tokens.refreshToken, deviceInfo, ipAddress);

    logger.info('User logged in', { userId: user.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        onboarding_complete: user.onboarding_complete,
      },
      tokens,
    };
  });
}

async function refreshTokens(refreshToken, deviceInfo = null, ipAddress = null) {
  const tokenHash = generateTokenHash(refreshToken);

  const result = await query(
    `SELECT rt.*, u.id as user_id
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    const err = new Error('Invalid or expired refresh token');
    err.statusCode = 401;
    throw err;
  }

  const { user_id, id: tokenId } = result.rows[0];

  return transaction(async (client) => {
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1',
      [tokenId]
    );

    const tokens = await generateTokenPair(user_id, deviceInfo, ipAddress);
    await storeRefreshToken(client, user_id, tokens.refreshToken, deviceInfo, ipAddress);

    return tokens;
  });
}

async function revokeRefreshToken(refreshToken) {
  const tokenHash = generateTokenHash(refreshToken);
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
    [tokenHash]
  );
}

async function revokeAllUserTokens(userId) {
  await query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

async function generateTokenPair(userId) {
  const accessToken = jwt.sign({ userId }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    issuer: 'kairos-api',
    audience: 'kairos-client',
  });

  const rawRefreshToken = generateSecureToken(48);

  const refreshTokenExpiry = new Date();
  refreshTokenExpiry.setDate(
    refreshTokenExpiry.getDate() +
      parseInt(config.jwt.refreshExpiresIn.replace('d', ''), 10)
  );

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: config.jwt.expiresIn,
    refreshExpiresAt: refreshTokenExpiry.toISOString(),
  };
}

async function storeRefreshToken(client, userId, rawToken, deviceInfo, ipAddress) {
  const tokenHash = generateTokenHash(rawToken);
  const expiresAt = new Date();
  expiresAt.setDate(
    expiresAt.getDate() +
      parseInt(config.jwt.refreshExpiresIn.replace('d', ''), 10)
  );

  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, deviceInfo, ipAddress, expiresAt]
  );
}

module.exports = { register, login, refreshTokens, revokeRefreshToken, revokeAllUserTokens };
