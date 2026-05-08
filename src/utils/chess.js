const { Chess } = require('chess.js');

function isValidFen(fen) {
  try {
    const chess = new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

function getPgn(pgn) {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return chess;
  } catch {
    return null;
  }
}

function extractMovesFromPgn(pgn) {
  const chess = getPgn(pgn);
  if (!chess) return [];
  return chess.history({ verbose: true });
}

function getPositionsFromPgn(pgn) {
  const chess = getPgn(pgn);
  if (!chess) return [];

  const positions = [];
  const history = chess.history({ verbose: true });

  chess.reset();
  chess.loadPgn(pgn);

  const tempChess = new Chess();

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const fenBefore = tempChess.fen();
    const colorToMove = tempChess.turn() === 'w' ? 'white' : 'black';

    tempChess.move(move.san);

    const timeSpent = extractMoveTime(pgn, i);

    positions.push({
      moveIndex: i,
      moveNumber: Math.ceil((i + 1) / 2),
      fen: fenBefore,
      move: { san: move.san, uci: move.from + move.to + (move.promotion || '') },
      colorToMove,
      timeSpentMs: timeSpent,
      isInEndgame: detectEndgame(tempChess),
    });
  }

  return positions;
}

function detectEndgame(chess) {
  const board = chess.board();
  let pieceCount = 0;
  let hasQueen = false;

  for (const row of board) {
    for (const piece of row) {
      if (!piece) continue;
      if (piece.type !== 'k' && piece.type !== 'p') {
        pieceCount++;
      }
      if (piece.type === 'q') hasQueen = true;
    }
  }

  return pieceCount <= 6 || (!hasQueen && pieceCount <= 8);
}

function extractMoveTime(pgn, moveIndex) {
  const clkRegex = /\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g;
  const matches = [...pgn.matchAll(clkRegex)];

  if (matches.length < 2 || moveIndex >= matches.length) return null;

  const parseClk = (m) => {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const sec = parseFloat(m[3]);
    return (h * 3600 + min * 60 + sec) * 1000;
  };

  if (moveIndex === 0) return null;

  const current = parseClk(matches[moveIndex]);
  const previous = parseClk(matches[moveIndex - 1]);
  const diff = previous - current;

  return diff > 0 ? diff : null;
}

function classifyMove(evalBefore, evalAfter, isBestMove, mateFound) {
  if (mateFound) return 'brilliant';
  if (isBestMove) return 'best';

  const loss = evalBefore - evalAfter;

  if (loss <= 0) return 'great';
  if (loss < 10) return 'best';
  if (loss < 25) return 'good';
  if (loss < 60) return 'inaccuracy';
  if (loss < 150) return 'mistake';
  return 'blunder';
}

function calculateAccuracy(moveEvals) {
  if (!moveEvals || moveEvals.length === 0) return 0;

  const accuracies = moveEvals
    .filter((m) => m.eval_before !== null && m.eval_after !== null)
    .map((m) => {
      const loss = Math.max(0, m.eval_before - m.eval_after);
      const accuracy = Math.max(0, 100 - (loss / 10));
      return Math.min(100, accuracy);
    });

  if (accuracies.length === 0) return 0;
  return parseFloat((accuracies.reduce((a, b) => a + b, 0) / accuracies.length).toFixed(2));
}

function getOpeningFromPgn(pgn) {
  const ecoMatch = pgn.match(/\[ECO "([^"]+)"\]/);
  const openingMatch = pgn.match(/\[Opening "([^"]+)"\]/);
  const variationMatch = pgn.match(/\[Variation "([^"]+)"\]/);

  return {
    eco: ecoMatch ? ecoMatch[1] : null,
    name: openingMatch
      ? openingMatch[1] + (variationMatch ? `, ${variationMatch[1]}` : '')
      : null,
  };
}

function getPgnHeaders(pgn) {
  const headers = {};
  const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = headerRegex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}

module.exports = {
  isValidFen,
  getPgn,
  extractMovesFromPgn,
  getPositionsFromPgn,
  detectEndgame,
  extractMoveTime,
  classifyMove,
  calculateAccuracy,
  getOpeningFromPgn,
  getPgnHeaders,
};
