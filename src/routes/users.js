const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscriptionGate');
const { validate, schemas } = require('../middleware/validate');
const { addGameFetchJob } = require('../queues');
const chessComService = require('../services/chessComService');
const lichessService = require('../services/lichessService');
const { getUsageSummary } = require('../services/usageService');
const { getUserMemories, deleteMemory } = require('../services/memoryService');
const { seedInitialMemories } = require('../services/memoryService');
const { success, created, error, notFound } = require('../utils/response');

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.chess_com_username, u.lichess_username,
              u.rating_chess_com, u.rating_lichess, u.preferred_platform, u.preferred_time_class,
              u.coach_personality, u.onboarding_complete, u.timezone, u.created_at,
              s.plan, s.status as subscription_status, s.trial_end, s.current_period_end,
              s.cancel_at_period_end
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) return notFound(res, 'User');

    return success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch('/me', authenticate, validate(schemas.updateProfile), async (req, res, next) => {
  try {
    const allowed = ['name', 'coach_personality', 'preferred_platform', 'preferred_time_class', 'timezone'];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return error(res, 'No valid fields to update', 400);
    }

    const setClauses = Object.keys(updates)
      .map((key, idx) => `${key} = $${idx + 2}`)
      .join(', ');

    const result = await query(
      `UPDATE users SET ${setClauses}, updated_at = NOW() WHERE id = $1
       RETURNING id, name, coach_personality, preferred_platform, preferred_time_class, timezone`,
      [req.user.id, ...Object.values(updates)]
    );

    return success(res, result.rows[0], 'Profile updated');
  } catch (err) {
    next(err);
  }
});

router.post('/connect-platform', authenticate, validate(schemas.connectPlatform), async (req, res, next) => {
  try {
    const { platform, username } = req.body;

    let platformProfile;
    if (platform === 'chess.com') {
      platformProfile = await chessComService.validateUser(username);
      const stats = await chessComService.getPlayerStats(username);

      await query(
        `UPDATE users SET chess_com_username = $1, rating_chess_com = $2, updated_at = NOW() WHERE id = $3`,
        [platformProfile.username, stats.blitz || stats.rapid || stats.bullet, req.user.id]
      );

      await query(
        `INSERT INTO rating_history (user_id, platform, time_class, rating)
         SELECT $1, 'chess.com', unnest(ARRAY['bullet','blitz','rapid']), unnest(ARRAY[$2::int,$3::int,$4::int])
         WHERE $2 IS NOT NULL OR $3 IS NOT NULL OR $4 IS NOT NULL`,
        [req.user.id, stats.bullet, stats.blitz, stats.rapid]
      ).catch(() => {});
    } else if (platform === 'lichess') {
      platformProfile = await lichessService.validateUser(username);

      await query(
        `UPDATE users SET lichess_username = $1, rating_lichess = $2, updated_at = NOW() WHERE id = $3`,
        [platformProfile.username, platformProfile.ratings?.blitz || platformProfile.ratings?.rapid, req.user.id]
      );
    }

    await addGameFetchJob(req.user.id, platform, { forceRefresh: false });

    return success(res, {
      platform,
      username: platformProfile.username,
      message: 'Platform connected. Your games are being fetched in the background.',
    }, 'Platform connected successfully');
  } catch (err) {
    if (err.statusCode === 404) return error(res, err.message, 404);
    next(err);
  }
});

router.post('/onboarding/complete', authenticate, async (req, res, next) => {
  try {
    await query(
      `UPDATE users SET onboarding_complete = TRUE, updated_at = NOW() WHERE id = $1`,
      [req.user.id]
    );

    return success(res, null, 'Onboarding completed');
  } catch (err) {
    next(err);
  }
});

router.post('/sync-games', authenticate, requireActiveSubscription, async (req, res, next) => {
  try {
    const { platform } = req.body;
    const userResult = await query(
      `SELECT chess_com_username, lichess_username FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = userResult.rows[0];

    const platforms = platform
      ? [platform]
      : [
          user.chess_com_username ? 'chess.com' : null,
          user.lichess_username ? 'lichess' : null,
        ].filter(Boolean);

    if (platforms.length === 0) {
      return error(res, 'No chess platform connected. Please connect Chess.com or Lichess first.', 400);
    }

    for (const p of platforms) {
      await addGameFetchJob(req.user.id, p, { forceRefresh: false });
    }

    return success(res, { platforms, message: 'Game sync started in background' }, 'Sync initiated');
  } catch (err) {
    next(err);
  }
});

router.get('/usage', authenticate, async (req, res, next) => {
  try {
    const summary = await getUsageSummary(req.user.id, req.user.plan);
    return success(res, summary);
  } catch (err) {
    next(err);
  }
});

router.get('/memories', authenticate, async (req, res, next) => {
  try {
    const memories = await getUserMemories(req.user.id);
    return success(res, { memories });
  } catch (err) {
    next(err);
  }
});

router.delete('/memories/:memoryId', authenticate, async (req, res, next) => {
  try {
    const deleted = await deleteMemory(req.user.id, req.params.memoryId);
    if (!deleted) return notFound(res, 'Memory');
    return success(res, null, 'Memory deleted');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
