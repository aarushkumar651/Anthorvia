const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { success, notFound } = require('../utils/response');

router.get('/weaknesses', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, category, subcategory, severity, occurrence_count, last_seen_at,
              ai_explanation, improvement_tip, is_resolved, created_at
       FROM user_weaknesses
       WHERE user_id = $1 AND is_resolved = FALSE
       ORDER BY severity DESC, occurrence_count DESC`,
      [req.user.id]
    );

    return success(res, { weaknesses: result.rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/weaknesses/:id/resolve', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE user_weaknesses
       SET is_resolved = TRUE, resolved_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) return notFound(res, 'Weakness');

    return success(res, null, 'Weakness marked as resolved');
  } catch (err) {
    next(err);
  }
});

router.get('/openings', authenticate, async (req, res, next) => {
  try {
    const { color } = req.query;
    const params = [req.user.id];
    let colorFilter = '';

    if (color && ['white', 'black'].includes(color)) {
      params.push(color);
      colorFilter = `AND color = $${params.length}`;
    }

    const result = await query(
      `SELECT eco, opening_name, color, games_played, wins, losses, draws, avg_accuracy, ai_recommendation,
              ROUND(wins * 100.0 / NULLIF(games_played, 0), 1) as win_rate
       FROM opening_stats
       WHERE user_id = $1 ${colorFilter}
       ORDER BY games_played DESC`,
      params
    );

    return success(res, { openings: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/accuracy-trend', authenticate, async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const daysInt = Math.min(365, Math.max(7, parseInt(days, 10)));

    const result = await query(
      `SELECT DATE(g.played_at) as date,
              ROUND(AVG(ga.accuracy_score), 1) as avg_accuracy,
              COUNT(*) as games_played
       FROM games g
       JOIN game_analyses ga ON ga.game_id = g.id
       WHERE g.user_id = $1
         AND g.played_at >= NOW() - INTERVAL '${daysInt} days'
       GROUP BY DATE(g.played_at)
       ORDER BY date ASC`,
      [req.user.id]
    );

    return success(res, { trend: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/rating-history', authenticate, async (req, res, next) => {
  try {
    const { platform, time_class } = req.query;
    const params = [req.user.id];
    const conditions = ['user_id = $1'];

    if (platform) { params.push(platform); conditions.push(`platform = $${params.length}`); }
    if (time_class) { params.push(time_class); conditions.push(`time_class = $${params.length}`); }

    const result = await query(
      `SELECT platform, time_class, rating, recorded_at
       FROM rating_history
       WHERE ${conditions.join(' AND ')}
       ORDER BY recorded_at ASC
       LIMIT 365`,
      params
    );

    return success(res, { history: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/dashboard', authenticate, async (req, res, next) => {
  try {
    const [weeklyStats, weaknesses, recentGames, accuracyTrend, openings] = await Promise.all([
      query(
        `SELECT COUNT(*) as games, COUNT(*) FILTER (WHERE user_result='win') as wins,
                ROUND(AVG(ga.accuracy_score),1) as avg_accuracy,
                ROUND(AVG(ga.blunder_count),2) as avg_blunders
         FROM games g LEFT JOIN game_analyses ga ON ga.game_id = g.id
         WHERE g.user_id = $1 AND g.played_at >= NOW() - INTERVAL '7 days'`,
        [req.user.id]
      ),
      query(
        `SELECT category, subcategory, severity FROM user_weaknesses
         WHERE user_id = $1 AND is_resolved = FALSE ORDER BY severity DESC LIMIT 3`,
        [req.user.id]
      ),
      query(
        `SELECT g.id, g.user_result, g.user_rating, g.played_at, g.time_class,
                g.white_username, g.black_username, g.user_color,
                ga.accuracy_score, ga.blunder_count
         FROM games g LEFT JOIN game_analyses ga ON ga.game_id = g.id
         WHERE g.user_id = $1 ORDER BY g.played_at DESC LIMIT 5`,
        [req.user.id]
      ),
      query(
        `SELECT DATE(g.played_at) as date, ROUND(AVG(ga.accuracy_score),1) as avg_accuracy
         FROM games g JOIN game_analyses ga ON ga.game_id = g.id
         WHERE g.user_id = $1 AND g.played_at >= NOW() - INTERVAL '14 days'
         GROUP BY DATE(g.played_at) ORDER BY date ASC`,
        [req.user.id]
      ),
      query(
        `SELECT eco, opening_name, color, games_played,
                ROUND(wins*100.0/NULLIF(games_played,0),0) as win_rate
         FROM opening_stats WHERE user_id = $1 AND games_played >= 3
         ORDER BY games_played DESC LIMIT 4`,
        [req.user.id]
      ),
    ]);

    return success(res, {
      weekly: weeklyStats.rows[0],
      top_weaknesses: weaknesses.rows,
      recent_games: recentGames.rows,
      accuracy_trend: accuracyTrend.rows,
      top_openings: openings.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
