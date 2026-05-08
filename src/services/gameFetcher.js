const { query, transaction } = require('../config/database');
const { addAnalysisJob } = require('../queues');
const chessComService = require('./chessComService');
const lichessService = require('./lichessService');
const logger = require('../config/logger');

async function fetchAndStoreGames(userId, platform, options = {}) {
  const { sinceTimestamp = null, analyzeImmediately = true } = options;

  const userResult = await query(
    `SELECT chess_com_username, lichess_username FROM users WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) throw new Error('User not found');

  const user = userResult.rows[0];

  const subResult = await query(
    'SELECT plan FROM subscriptions WHERE user_id = $1',
    [userId]
  );
  const plan = subResult.rows[0]?.plan || 'free';

  let rawGames = [];
  let username;

  if (platform === 'chess.com') {
    username = user.chess_com_username;
    if (!username) throw new Error('Chess.com username not connected');
    rawGames = await chessComService.fetchRecentGames(username, sinceTimestamp);
    rawGames = rawGames.map((g) => chessComService.normalizeGame(g, username));
  } else if (platform === 'lichess') {
    username = user.lichess_username;
    if (!username) throw new Error('Lichess username not connected');
    const since = sinceTimestamp || null;
    rawGames = await lichessService.fetchRecentGames(username, since);
    rawGames = rawGames.map((g) => lichessService.normalizeGame(g, username));
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  if (rawGames.length === 0) {
    return { stored: 0, alreadyExisted: 0, queued: 0 };
  }

  const { stored, alreadyExisted, newGameIds } = await storeGames(userId, rawGames);

  let queued = 0;
  if (analyzeImmediately && newGameIds.length > 0) {
    await query(
      `UPDATE games SET analysis_status = 'queued', analysis_queued_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [newGameIds]
    );

    for (const gameId of newGameIds) {
      await addAnalysisJob(gameId, userId, plan);
      queued++;
    }
  }

  logger.info('Games fetched and stored', { userId, platform, stored, alreadyExisted, queued });

  return { stored, alreadyExisted, queued };
}

async function storeGames(userId, normalizedGames) {
  let stored = 0;
  let alreadyExisted = 0;
  const newGameIds = [];

  for (const game of normalizedGames) {
    if (!game.pgn || !game.played_at) continue;

    try {
      const result = await query(
        `INSERT INTO games (
          user_id, platform, platform_game_id, pgn, white_username, black_username,
          user_color, time_control, time_class, result, user_result,
          user_rating, opponent_rating, opening_eco, opening_name, termination, played_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (platform, platform_game_id, user_id) DO NOTHING
        RETURNING id`,
        [
          userId,
          game.platform,
          game.platform_game_id,
          game.pgn,
          game.white_username,
          game.black_username,
          game.user_color,
          game.time_control,
          game.time_class,
          game.result,
          game.user_result,
          game.user_rating,
          game.opponent_rating,
          game.opening_eco,
          game.opening_name,
          game.termination,
          game.played_at,
        ]
      );

      if (result.rows.length > 0) {
        stored++;
        newGameIds.push(result.rows[0].id);
      } else {
        alreadyExisted++;
      }
    } catch (err) {
      logger.warn('Failed to store game', {
        userId,
        gameId: game.platform_game_id,
        error: err.message,
      });
    }
  }

  return { stored, alreadyExisted, newGameIds };
}

async function getLatestGameTimestamp(userId, platform) {
  const result = await query(
    `SELECT EXTRACT(EPOCH FROM MAX(played_at)) * 1000 as latest_ts
     FROM games WHERE user_id = $1 AND platform = $2`,
    [userId, platform]
  );
  return result.rows[0]?.latest_ts ? parseInt(result.rows[0].latest_ts, 10) : null;
}

module.exports = { fetchAndStoreGames, getLatestGameTimestamp };
