const fetch = require('node-fetch');
const logger = require('../config/logger');
const { getRedis } = require('../config/redis');

const BASE_URL = 'https://lichess.org/api';

async function validateUser(username) {
  const redis = getRedis();
  const cacheKey = `lichess:profile:${username.toLowerCase()}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const res = await fetch(`${BASE_URL}/user/${username}`, {
    headers: { Accept: 'application/json' },
    timeout: 15000,
  });

  if (!res.ok) {
    if (res.status === 404) {
      const err = new Error(`Lichess username "${username}" not found`);
      err.statusCode = 404;
      throw err;
    }
    throw new Error(`Lichess API error: ${res.status}`);
  }

  const data = await res.json();
  const result = {
    username: data.username,
    name: data.profile?.realName || data.username,
    ratings: {
      bullet: data.perfs?.bullet?.rating || null,
      blitz: data.perfs?.blitz?.rating || null,
      rapid: data.perfs?.rapid?.rating || null,
      classical: data.perfs?.classical?.rating || null,
    },
  };

  await redis.setex(cacheKey, 300, JSON.stringify(result));
  return result;
}

async function fetchRecentGames(username, sinceTimestamp = null, maxGames = 300) {
  const params = new URLSearchParams({
    max: String(Math.min(maxGames, 500)),
    clocks: 'true',
    evals: 'false',
    opening: 'true',
    perfType: 'bullet,blitz,rapid,classical',
    color: 'white',
  });

  if (sinceTimestamp) {
    params.set('since', String(sinceTimestamp));
  }

  const allGames = [];

  for (const color of ['white', 'black']) {
    params.set('color', color);

    const res = await fetch(`${BASE_URL}/games/user/${username}?${params}`, {
      headers: {
        Accept: 'application/x-ndjson',
      },
      timeout: 60000,
    });

    if (!res.ok) {
      if (res.status === 404) {
        const err = new Error(`Lichess user not found: ${username}`);
        err.statusCode = 404;
        throw err;
      }
      if (res.status === 429) {
        await sleep(60000);
        continue;
      }
      logger.warn('Lichess fetch failed', { username, status: res.status, color });
      continue;
    }

    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      try {
        const game = JSON.parse(line);
        allGames.push(game);
      } catch {
        // skip malformed lines
      }
    }

    await sleep(1000);
  }

  const seen = new Set();
  return allGames.filter((g) => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });
}

function normalizeGame(rawGame, username) {
  const whiteName = rawGame.players?.white?.user?.name || rawGame.players?.white?.user?.id || '';
  const blackName = rawGame.players?.black?.user?.name || rawGame.players?.black?.user?.id || '';
  const userIsWhite = whiteName.toLowerCase() === username.toLowerCase();
  const userColor = userIsWhite ? 'white' : 'black';

  const status = rawGame.status;
  let userResult = 'draw';

  if (status === 'draw' || status === 'stalemate' || status === 'abortedByMutualAgreement') {
    userResult = 'draw';
  } else if (rawGame.winner) {
    userResult = rawGame.winner === userColor ? 'win' : 'loss';
  }

  let result = '1/2-1/2';
  if (rawGame.winner === 'white') result = '1-0';
  else if (rawGame.winner === 'black') result = '0-1';

  const timeClass = mapLichessSpeed(rawGame.speed);

  const pgn = rawGame.moves
    ? buildPgnFromLichess(rawGame, whiteName, blackName, username)
    : '';

  return {
    platform: 'lichess',
    platform_game_id: rawGame.id,
    pgn,
    white_username: whiteName,
    black_username: blackName,
    user_color: userColor,
    time_control: rawGame.clock
      ? `${rawGame.clock.initial}+${rawGame.clock.increment}`
      : rawGame.speed,
    time_class: timeClass,
    result,
    user_result: userResult,
    user_rating: userIsWhite
      ? rawGame.players?.white?.rating
      : rawGame.players?.black?.rating,
    opponent_rating: userIsWhite
      ? rawGame.players?.black?.rating
      : rawGame.players?.white?.rating,
    opening_eco: rawGame.opening?.eco || null,
    opening_name: rawGame.opening?.name || null,
    termination: status || null,
    played_at: new Date(rawGame.createdAt).toISOString(),
  };
}

function buildPgnFromLichess(game, whiteName, blackName, username) {
  const date = new Date(game.createdAt);
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '.');
  const timeStr = date.toISOString().split('T')[1].slice(0, 8);

  const result = game.winner
    ? game.winner === 'white'
      ? '1-0'
      : '0-1'
    : '1/2-1/2';

  const headers = [
    `[Event "Lichess ${capitalize(game.speed)} game"]`,
    `[Site "https://lichess.org/${game.id}"]`,
    `[Date "${dateStr}"]`,
    `[Round "-"]`,
    `[White "${whiteName}"]`,
    `[Black "${blackName}"]`,
    `[Result "${result}"]`,
    `[WhiteElo "${game.players?.white?.rating || '?'}"]`,
    `[BlackElo "${game.players?.black?.rating || '?'}"]`,
    game.opening?.eco ? `[ECO "${game.opening.eco}"]` : null,
    game.opening?.name ? `[Opening "${game.opening.name}"]` : null,
    game.clock ? `[TimeControl "${game.clock.initial}+${game.clock.increment}"]` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const movesStr = formatLichessMoves(game.moves, game.clocks);

  return `${headers}\n\n${movesStr} ${result}`;
}

function formatLichessMoves(movesStr, clocks = []) {
  if (!movesStr) return '';
  const moves = movesStr.split(' ');
  const formatted = [];

  for (let i = 0; i < moves.length; i++) {
    const moveNum = Math.floor(i / 2) + 1;
    if (i % 2 === 0) formatted.push(`${moveNum}.`);
    formatted.push(moves[i]);

    if (clocks && clocks[i] !== undefined) {
      const secs = Math.floor(clocks[i] / 100);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      formatted.push(
        `{ [%clk ${String(h).padStart(1, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}] }`
      );
    }
  }

  return formatted.join(' ');
}

function mapLichessSpeed(speed) {
  const map = {
    ultraBullet: 'bullet',
    bullet: 'bullet',
    blitz: 'blitz',
    rapid: 'rapid',
    classical: 'classical',
    correspondence: 'correspondence',
  };
  return map[speed] || 'unknown';
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { validateUser, fetchRecentGames, normalizeGame };
