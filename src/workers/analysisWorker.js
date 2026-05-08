require('dotenv').config();
const { Worker } = require('bullmq');
const { getBullMQConnection } = require('../config/redis');
const { validateEnv } = require('../config/env');
const { testConnection } = require('../config/database');
const { query } = require('../config/database');
const { analyzeGame } = require('../services/stockfishService');
const { getPositionsFromPgn, classifyMove, calculateAccuracy, getOpeningFromPgn } = require('../utils/chess');
const { updateUserPatterns, updateOpeningStats } = require('../services/patternEngine');
const { generateCoachComment } = require('../services/aiService');
const logger = require('../config/logger');
const { config } = require('../config/env');

validateEnv();

const DEPTH_BY_PLAN = config.stockfish.depthByPlan;

const worker = new Worker(
  'kairos:analysis',
  async (job) => {
    const { gameId, userId, plan } = job.data;
    const depth = DEPTH_BY_PLAN[plan] || DEPTH_BY_PLAN.free;

    logger.info('Starting analysis', { gameId, userId, depth });

    await job.updateProgress(5);

    const gameResult = await query(
      `SELECT * FROM games WHERE id = $1 AND user_id = $2`,
      [gameId, userId]
    );

    if (gameResult.rows.length === 0) {
      throw new Error(`Game ${gameId} not found`);
    }

    const game = gameResult.rows[0];

    if (!game.pgn) {
      throw new Error(`Game ${gameId} has no PGN data`);
    }

    await query(
      `UPDATE games SET analysis_status = 'analyzing' WHERE id = $1`,
      [gameId]
    );

    await job.updateProgress(10);

    const positions = getPositionsFromPgn(game.pgn);

    const userPositions = positions.filter((p) => p.colorToMove === game.user_color);

    if (userPositions.length === 0) {
      await markAnalysisDone(gameId, userId, [], game);
      return { gameId, movesAnalyzed: 0 };
    }

    await job.updateProgress(15);

    const rawEvals = await analyzeGame(userPositions, game.user_color, depth);

    await job.updateProgress(70);

    const moveAnalyses = rawEvals.map((evalResult) => ({
      ...evalResult,
      classification: classifyMove(
        evalResult.evalBefore,
        evalResult.evalAfter,
        evalResult.isBestMove,
        false
      ),
      evalLoss: evalResult.evalLoss,
    }));

    await storeMoveAnalyses(gameId, userId, moveAnalyses);

    await job.updateProgress(80);

    const accuracyScore = calculateAccuracy(
      moveAnalyses.map((m) => ({ eval_before: m.evalBefore, eval_after: m.evalAfter }))
    );

    const blunderCount = moveAnalyses.filter((m) => m.classification === 'blunder').length;
    const mistakeCount = moveAnalyses.filter((m) => m.classification === 'mistake').length;
    const inaccuracyCount = moveAnalyses.filter((m) => m.classification === 'inaccuracy').length;
    const goodCount = moveAnalyses.filter((m) => m.classification === 'good').length;
    const bestCount = moveAnalyses.filter((m) => ['best', 'great', 'brilliant'].includes(m.classification)).length;

    const openingMoves = moveAnalyses.filter((m) => m.moveNumber <= 15);
    const middlegameMoves = moveAnalyses.filter((m) => m.moveNumber > 15 && m.moveNumber <= 35);
    const endgameMoves = moveAnalyses.filter((m) => m.moveNumber > 35 || m.isInEndgame);

    const criticalMoments = moveAnalyses
      .filter((m) => m.evalLoss && m.evalLoss > 150)
      .slice(0, 5)
      .map((m) => ({
        move_number: m.moveNumber,
        san: m.san,
        eval_swing: m.evalLoss,
        classification: m.classification,
      }));

    const timePressureBlunders = moveAnalyses.filter(
      (m) => m.classification === 'blunder' && m.timeSpentMs !== null && m.timeSpentMs < 5000
    ).length;

    const avgMoveTime =
      moveAnalyses.filter((m) => m.timeSpentMs !== null).length > 0
        ? Math.round(
            moveAnalyses
              .filter((m) => m.timeSpentMs !== null)
              .reduce((a, b) => a + b.timeSpentMs, 0) /
              moveAnalyses.filter((m) => m.timeSpentMs !== null).length
          )
        : null;

    const [openingComment, middlegameComment, endgameComment] = await Promise.all([
      openingMoves.length > 0 ? generateCoachComment('opening', openingMoves, game.user_color) : Promise.resolve(null),
      middlegameMoves.length > 0 ? generateCoachComment('middlegame', middlegameMoves, game.user_color) : Promise.resolve(null),
      endgameMoves.length > 0 ? generateCoachComment('endgame', endgameMoves, game.user_color) : Promise.resolve(null),
    ]);

    await job.updateProgress(90);

    const keyLesson = await generateKeyLesson(moveAnalyses, game);

    await query(
      `INSERT INTO game_analyses (
        game_id, user_id, depth, accuracy_score, blunder_count, mistake_count,
        inaccuracy_count, good_count, best_count, opening_accuracy, middlegame_accuracy,
        endgame_accuracy, avg_move_time_ms, time_pressure_blunders, move_evaluations,
        critical_moments, opening_comment, middlegame_comment, endgame_comment, key_lesson
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (game_id) DO UPDATE
      SET accuracy_score=$4, blunder_count=$5, mistake_count=$6, inaccuracy_count=$7,
          good_count=$8, best_count=$9, opening_accuracy=$10, middlegame_accuracy=$11,
          endgame_accuracy=$12, avg_move_time_ms=$13, time_pressure_blunders=$14,
          move_evaluations=$15, critical_moments=$16, opening_comment=$17,
          middlegame_comment=$18, endgame_comment=$19, key_lesson=$20, analyzed_at=NOW()`,
      [
        gameId,
        userId,
        depth,
        accuracyScore,
        blunderCount,
        mistakeCount,
        inaccuracyCount,
        goodCount,
        bestCount,
        calculateAccuracy(openingMoves.map((m) => ({ eval_before: m.evalBefore, eval_after: m.evalAfter }))),
        calculateAccuracy(middlegameMoves.map((m) => ({ eval_before: m.evalBefore, eval_after: m.evalAfter }))),
        calculateAccuracy(endgameMoves.map((m) => ({ eval_before: m.evalBefore, eval_after: m.evalAfter }))),
        avgMoveTime,
        timePressureBlunders,
        JSON.stringify(moveAnalyses.slice(0, 100)),
        JSON.stringify(criticalMoments),
        openingComment,
        middlegameComment,
        endgameComment,
        keyLesson,
      ]
    );

    await query(`UPDATE games SET analysis_status = 'done' WHERE id = $1`, [gameId]);

    await updateUserPatterns(userId, moveAnalyses, gameId);

    if (game.opening_eco) {
      await updateOpeningStats(
        userId,
        gameId,
        game.opening_eco,
        game.opening_name,
        game.user_color,
        game.user_result,
        accuracyScore
      );
    }

    await query(
      `INSERT INTO usage_logs (user_id, action, metadata)
       VALUES ($1, 'game_analysis', $2)`,
      [userId, JSON.stringify({ gameId, depth, moves: moveAnalyses.length })]
    );

    await query(
      `INSERT INTO usage_monthly (user_id, month, game_analysis_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, month) DO UPDATE
       SET game_analysis_count = usage_monthly.game_analysis_count + 1`,
      [userId, getCurrentMonth()]
    );

    await job.updateProgress(100);

    logger.info('Analysis complete', { gameId, userId, accuracy: accuracyScore, blunders: blunderCount });

    return { gameId, accuracy: accuracyScore, movesAnalyzed: moveAnalyses.length };
  },
  {
    connection: getBullMQConnection(),
    concurrency: config.queue.concurrencyAnalysis,
  }
);

async function storeMoveAnalyses(gameId, userId, moveAnalyses) {
  if (moveAnalyses.length === 0) return;

  await query(`DELETE FROM move_analyses WHERE game_id = $1`, [gameId]);

  const chunkSize = 50;
  for (let i = 0; i < moveAnalyses.length; i += chunkSize) {
    const chunk = moveAnalyses.slice(i, i + chunkSize);

    const values = chunk.map((m, idx) => {
      const base = idx * 12;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12})`;
    });

    const params = chunk.flatMap((m) => [
      gameId,
      userId,
      m.moveNumber,
      m.colorToMove,
      m.san,
      m.uci,
      m.fenBefore,
      m.evalBefore,
      m.evalAfter,
      m.bestMoveUci,
      m.evalLoss,
      m.classification,
    ]);

    await query(
      `INSERT INTO move_analyses (game_id, user_id, move_number, color, san, uci, fen_before, eval_before, eval_after, best_move_uci, eval_loss, classification)
       VALUES ${values.join(', ')}`,
      params
    );
  }
}

async function generateKeyLesson(moveAnalyses, game) {
  const worstBlunder = moveAnalyses
    .filter((m) => m.classification === 'blunder')
    .sort((a, b) => b.evalLoss - a.evalLoss)[0];

  if (!worstBlunder) {
    return `Good game! Focus on maintaining your current accuracy level and looking for improvements in the opening.`;
  }

  return `Your biggest mistake was move ${worstBlunder.moveNumber} (${worstBlunder.san}), which lost approximately ${Math.round(worstBlunder.evalLoss)} centipawns. The computer preferred ${worstBlunder.bestMoveUci}. Study this position carefully.`;
}

async function markAnalysisDone(gameId, userId, moveAnalyses, game) {
  await query(`UPDATE games SET analysis_status = 'done' WHERE id = $1`, [gameId]);
  await query(
    `INSERT INTO game_analyses (game_id, user_id, depth, accuracy_score, blunder_count, move_evaluations, critical_moments)
     VALUES ($1, $2, 14, 0, 0, '[]', '[]')
     ON CONFLICT (game_id) DO NOTHING`,
    [gameId, userId]
  );
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

worker.on('completed', (job, result) => {
  logger.info('Analysis job completed', { jobId: job.id, ...result });
});

worker.on('failed', async (job, err) => {
  logger.error('Analysis job failed', { jobId: job.id, gameId: job.data.gameId, error: err.message });
  try {
    await query(
      `UPDATE games SET analysis_status = 'failed', analysis_failed_reason = $1 WHERE id = $2`,
      [err.message.slice(0, 500), job.data.gameId]
    );
  } catch (dbErr) {
    logger.error('Failed to update game status after job failure', { error: dbErr.message });
  }
});

worker.on('error', (err) => {
  logger.error('Analysis worker error', { error: err.message });
});

logger.info('Analysis worker started', { concurrency: config.queue.concurrencyAnalysis });

process.on('SIGTERM', async () => {
  await worker.close();
  logger.info('Analysis worker stopped gracefully');
  process.exit(0);
});
