const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireActiveSubscription } = require('../middleware/subscriptionGate');
const { validate, schemas } = require('../middleware/validate');
const { getPagination } = require('../utils/pagination');
const { addAnalysisJob } = require('../queues');
const { success, error, paginated, notFound } = require('../utils/response');

router.get('/', authenticate, validate(schemas.paginationQuery, 'query'), async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const { platform, time_class, result, sort, order } = req.query;

    const conditions = ['g.user_id = $1'];
    const params = [req.user.id];

    if (platform) {
      params.push(platform);
      conditions.push(`g.platform = $${params.length}`);
    }
    if (time_class) {
      params.push(time_class);
      conditions.push(`g.time_class = $${params.length}`);
    }
    if (result) {
      params.push(result);
      conditions.push(`g.user_result = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const sortColumn = sort === 'accuracy_score' ? 'ga.accuracy_score' : `g.${sort}`;
    const orderDir = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const countResult = await query(
      `SELECT COUNT(*) FROM games g WHERE ${whereClause}`,
      params
    );

    const gamesResult = await query(
      `SELECT g.id, g.platform, g.white_username, g.black_username, g.user_color,
              g.time_class, g.time_control, g.result, g.user_result,
              g.user_rating, g.opponent_rating, g.opening_eco, g.opening_name,
              g.played_at, g.analysis_status,
              ga.accuracy_score, ga.blunder_count, ga.mistake_count
       FROM games g
       LEFT JOIN game_analyses ga ON ga.game_id = g.id
       WHERE ${whereClause}
       ORDER BY ${sortColumn} ${orderDir} NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return paginated(res, gamesResult.rows, parseInt(countResult.rows[0].count, 10), page, limit);
  } catch (err) {
    next(err);
  }
});

router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         COUNT(*) as total_games,
         COUNT(*) FILTER (WHERE user_result = 'win') as wins,
         COUNT(*) FILTER (WHERE user_result = 'loss') as losses,
         COUNT(*) FILTER (WHERE user_result = 'draw') as draws,
         ROUND(AVG(ga.accuracy_score), 1) as avg_accuracy,
         ROUND(AVG(ga.blunder_count), 2) as avg_blunders,
         COUNT(*) FILTER (WHERE analysis_status = 'done') as analyzed_count,
         COUNT(*) FILTER (WHERE analysis_status = 'pending') as pending_count
       FROM games g
       LEFT JOIN game_analyses ga ON ga.game_id = g.id
       WHERE g.user_id = $1`,
      [req.user.id]
    );

    const byTimeClass = await query(
      `SELECT time_class, COUNT(*) as games,
              ROUND(AVG(ga.accuracy_score), 1) as avg_accuracy,
              COUNT(*) FILTER (WHERE user_result = 'win') as wins
       FROM games g
       LEFT JOIN game_analyses ga ON ga.game_id = g.id
       WHERE g.user_id = $1 AND time_class != 'unknown'
       GROUP BY time_class
       ORDER BY games DESC`,
      [req.user.id]
    );

    return success(res, {
      overall: result.rows[0],
      by_time_class: byTimeClass.rows,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:gameId', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT g.*, ga.accuracy_score, ga.blunder_count, ga.mistake_count, ga.inaccuracy_count,
              ga.opening_accuracy, ga.middlegame_accuracy, ga.endgame_accuracy,
              ga.opening_comment, ga.middlegame_comment, ga.endgame_comment,
              ga.key_lesson, ga.critical_moments, ga.coach_summary,
              ga.avg_move_time_ms, ga.time_pressure_blunders, ga.analyzed_at
       FROM games g
       LEFT JOIN game_analyses ga ON ga.game_id = g.id
       WHERE g.id = $1 AND g.user_id = $2`,
      [req.params.gameId, req.user.id]
    );

    if (result.rows.length === 0) return notFound(res, 'Game');

    return success(res, result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get('/:gameId/moves', authenticate, async (req, res, next) => {
  try {
    const gameCheck = await query(
      'SELECT id FROM games WHERE id = $1 AND user_id = $2',
      [req.params.gameId, req.user.id]
    );

    if (gameCheck.rows.length === 0) return notFound(res, 'Game');

    const moves = await query(
      `SELECT move_number, color, san, uci, fen_before, eval_before, eval_after,
              best_move_uci, best_move_san, eval_loss, classification, time_spent_ms, is_in_endgame
       FROM move_analyses
       WHERE game_id = $1
       ORDER BY move_number ASC, color ASC`,
      [req.params.gameId]
    );

    return success(res, { moves: moves.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:gameId/reanalyze', authenticate, requireActiveSubscription, async (req, res, next) => {
  try {
    const gameCheck = await query(
      `SELECT id, analysis_status FROM games WHERE id = $1 AND user_id = $2`,
      [req.params.gameId, req.user.id]
    );

    if (gameCheck.rows.length === 0) return notFound(res, 'Game');

    if (gameCheck.rows[0].analysis_status === 'analyzing') {
      return error(res, 'Game is already being analyzed', 409);
    }

    await query(
      `UPDATE games SET analysis_status = 'queued', analysis_queued_at = NOW() WHERE id = $1`,
      [req.params.gameId]
    );

    await addAnalysisJob(req.params.gameId, req.user.id, req.user.plan);

    return success(res, { message: 'Reanalysis queued' }, 'Analysis queued');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
