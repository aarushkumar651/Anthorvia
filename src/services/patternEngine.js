const { query } = require('../config/database');
const { Chess } = require('chess.js');
const logger = require('../config/logger');

async function updateUserPatterns(userId, moveAnalyses, gameId) {
  const detectedPatterns = detectPatternsFromMoves(moveAnalyses, gameId);

  for (const pattern of detectedPatterns) {
    await query(
      `INSERT INTO user_weaknesses (user_id, category, subcategory, occurrence_count, severity, games_sample, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, category, subcategory) DO UPDATE
       SET occurrence_count = user_weaknesses.occurrence_count + EXCLUDED.occurrence_count,
           severity = GREATEST(user_weaknesses.severity, EXCLUDED.severity),
           games_sample = (
             SELECT jsonb_agg(DISTINCT val)
             FROM jsonb_array_elements(
               user_weaknesses.games_sample || EXCLUDED.games_sample
             ) val
             LIMIT 10
           ),
           last_seen_at = NOW(),
           updated_at = NOW()`,
      [
        userId,
        pattern.category,
        pattern.subcategory,
        pattern.count,
        pattern.severity,
        JSON.stringify([gameId]),
      ]
    );
  }

  return detectedPatterns;
}

function detectPatternsFromMoves(moveAnalyses, gameId) {
  const patterns = [];
  const blunders = moveAnalyses.filter((m) => m.classification === 'blunder');
  const mistakes = moveAnalyses.filter((m) => m.classification === 'mistake');

  if (blunders.length >= 2) {
    patterns.push({
      category: 'tactical',
      subcategory: 'repeated_blunders',
      count: blunders.length,
      severity: Math.min(5, blunders.length),
    });
  }

  const timePressureBlunders = blunders.filter(
    (m) => m.timeSpentMs !== null && m.timeSpentMs < 5000
  );
  if (timePressureBlunders.length >= 1) {
    patterns.push({
      category: 'time_management',
      subcategory: 'time_pressure_blunders',
      count: timePressureBlunders.length,
      severity: Math.min(4, timePressureBlunders.length + 1),
    });
  }

  const endgameBlunders = blunders.filter((m) => m.isInEndgame);
  if (endgameBlunders.length >= 1) {
    patterns.push({
      category: 'endgame',
      subcategory: 'endgame_blunders',
      count: endgameBlunders.length,
      severity: Math.min(5, endgameBlunders.length + 1),
    });
  }

  for (const move of [...blunders, ...mistakes]) {
    const pattern = detectPositionalPattern(move.fenBefore);
    if (pattern) {
      patterns.push({
        category: 'tactical',
        subcategory: pattern,
        count: 1,
        severity: move.classification === 'blunder' ? 3 : 2,
      });
    }
  }

  const openingBlunders = moveAnalyses.filter(
    (m) => m.moveNumber <= 15 && m.classification === 'blunder'
  );
  if (openingBlunders.length >= 1) {
    patterns.push({
      category: 'opening',
      subcategory: 'opening_blunders',
      count: openingBlunders.length,
      severity: Math.min(4, openingBlunders.length + 1),
    });
  }

  return patterns;
}

function detectPositionalPattern(fen) {
  try {
    const chess = new Chess(fen);

    if (isBackRankWeakness(chess)) return 'back_rank_weakness';
    if (isUndefendedPiece(chess)) return 'hanging_pieces';
    if (isKingSafetyIssue(chess)) return 'king_safety';

    return null;
  } catch {
    return null;
  }
}

function isBackRankWeakness(chess) {
  const board = chess.board();
  const turn = chess.turn();

  const backRankRow = turn === 'w' ? 0 : 7;
  const row = board[backRankRow];
  const kingFile = row.findIndex((p) => p?.type === 'k' && p?.color === turn);

  if (kingFile === -1) return false;

  let hasEscapeSquare = false;
  for (let i = kingFile - 1; i <= kingFile + 1; i++) {
    if (i < 0 || i > 7) continue;
    const piece = row[i];
    if (!piece || piece.color !== turn) {
      hasEscapeSquare = true;
      break;
    }
    const frontRow = turn === 'w' ? backRankRow + 1 : backRankRow - 1;
    if (frontRow >= 0 && frontRow <= 7) {
      const frontPiece = board[frontRow][i];
      if (!frontPiece) hasEscapeSquare = true;
    }
  }

  return !hasEscapeSquare;
}

function isUndefendedPiece(chess) {
  return false;
}

function isKingSafetyIssue(chess) {
  return false;
}

async function generateWeaknessInsights(userId) {
  const result = await query(
    `SELECT category, subcategory, severity, occurrence_count, games_sample
     FROM user_weaknesses
     WHERE user_id = $1 AND is_resolved = FALSE
     ORDER BY severity DESC, occurrence_count DESC
     LIMIT 10`,
    [userId]
  );

  return result.rows;
}

async function updateOpeningStats(userId, gameId, openingEco, openingName, userColor, userResult, accuracy) {
  if (!openingEco) return;

  const wins = userResult === 'win' ? 1 : 0;
  const losses = userResult === 'loss' ? 1 : 0;
  const draws = userResult === 'draw' ? 1 : 0;

  await query(
    `INSERT INTO opening_stats (user_id, eco, opening_name, color, games_played, wins, losses, draws, avg_accuracy)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8)
     ON CONFLICT (user_id, eco, color) DO UPDATE
     SET games_played = opening_stats.games_played + 1,
         wins = opening_stats.wins + EXCLUDED.wins,
         losses = opening_stats.losses + EXCLUDED.losses,
         draws = opening_stats.draws + EXCLUDED.draws,
         avg_accuracy = (opening_stats.avg_accuracy * opening_stats.games_played + EXCLUDED.avg_accuracy) / (opening_stats.games_played + 1),
         opening_name = EXCLUDED.opening_name,
         updated_at = NOW()`,
    [userId, openingEco, openingName, userColor, wins, losses, draws, accuracy || 0]
  );
}

module.exports = { updateUserPatterns, generateWeaknessInsights, updateOpeningStats };
