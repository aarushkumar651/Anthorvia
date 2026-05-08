const { EventEmitter } = require('events');
const logger = require('../config/logger');

class StockfishEngine extends EventEmitter {
  constructor() {
    super();
    this.engine = null;
    this.ready = false;
    this.queue = [];
    this.processing = false;
  }

  async initialize() {
    const Stockfish = require('stockfish');
    this.engine = Stockfish();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Stockfish init timeout')), 10000);

      this.engine.onmessage = (message) => {
        const msg = typeof message === 'object' ? message.data : message;

        if (msg === 'uciok') {
          this.engine.postMessage('isready');
        } else if (msg === 'readyok') {
          clearTimeout(timeout);
          this.ready = true;
          resolve();
        }

        this.emit('message', msg);
      };

      this.engine.postMessage('uci');
    });
  }

  async evaluate(fen, depth = 18) {
    if (!this.ready) await this.initialize();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Stockfish evaluation timed out for depth ${depth}`));
      }, 30000);

      const results = [];
      let bestMove = null;
      let resolved = false;

      const handleMessage = (message) => {
        const msg = typeof message === 'object' ? message.data : message;

        if (msg.startsWith('info depth')) {
          const parsed = parseInfoLine(msg);
          if (parsed) results.push(parsed);
        }

        if (msg.startsWith('bestmove')) {
          const parts = msg.split(' ');
          bestMove = parts[1];

          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.engine.onmessage = null;

            const deepestResult = results
              .filter((r) => r.depth === depth || r.depth === depth - 1)
              .sort((a, b) => b.depth - a.depth)[0];

            const fallback = results.sort((a, b) => b.depth - a.depth)[0];
            const final = deepestResult || fallback;

            resolve({
              bestMove,
              score: final?.score || 0,
              scoreType: final?.scoreType || 'cp',
              depth: final?.depth || depth,
              pv: final?.pv || [],
            });
          }
        }
      };

      this.engine.onmessage = handleMessage;
      this.engine.postMessage('position fen ' + fen);
      this.engine.postMessage(`go depth ${depth}`);
    });
  }

  async evaluatePosition(fen, depth) {
    this.engine.postMessage('ucinewgame');
    await sleep(10);
    return this.evaluate(fen, depth);
  }

  stop() {
    if (this.engine) {
      this.engine.postMessage('quit');
      this.engine = null;
      this.ready = false;
    }
  }
}

function parseInfoLine(line) {
  const depthMatch = line.match(/depth (\d+)/);
  const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
  const pvMatch = line.match(/pv (.+)/);
  const multipvMatch = line.match(/multipv (\d+)/);

  if (!depthMatch || !scoreMatch) return null;

  const multipv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
  if (multipv !== 1) return null;

  const depth = parseInt(depthMatch[1], 10);
  const scoreType = scoreMatch[1];
  let score = parseInt(scoreMatch[2], 10);

  if (scoreType === 'mate') {
    score = score > 0 ? 10000 - score : -10000 - score;
  }

  const pv = pvMatch ? pvMatch[1].trim().split(' ') : [];

  return { depth, score, scoreType, pv };
}

function normalizeScore(score, colorToMove) {
  return colorToMove === 'black' ? -score : score;
}

async function analyzeGame(positions, userColor, depth) {
  const engine = new StockfishEngine();
  await engine.initialize();

  const results = [];

  try {
    for (const position of positions) {
      const evalResult = await engine.evaluatePosition(position.fen, depth);

      const evalCp = normalizeScore(evalResult.score, position.colorToMove);
      const bestMove = evalResult.bestMove;
      const isBestMove = position.move.uci === bestMove;

      results.push({
        moveIndex: position.moveIndex,
        moveNumber: position.moveNumber,
        san: position.move.san,
        uci: position.move.uci,
        fenBefore: position.fen,
        evalBefore: null,
        evalAfter: evalCp,
        bestMoveUci: bestMove,
        bestMoveSan: null,
        isBestMove,
        timeSpentMs: position.timeSpentMs,
        isInEndgame: position.isInEndgame,
        colorToMove: position.colorToMove,
      });

      await sleep(20);
    }

    for (let i = 0; i < results.length; i++) {
      if (i === 0) {
        results[i].evalBefore = 0;
      } else {
        results[i].evalBefore = results[i - 1].evalAfter;
      }
      results[i].evalLoss = Math.max(0, results[i].evalBefore - results[i].evalAfter);
    }
  } finally {
    engine.stop();
  }

  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { analyzeGame, StockfishEngine };
