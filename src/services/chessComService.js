const fetch = require('node-fetch');
const logger = require('../config/logger');
const { getRedis } = require('../config/redis');

const BASE_URL = 'https://api.chess.com/pub';
const CACHE_TTL = 3600;

async function fetchWithCache(url, cacheKey, ttl = CACHE_TTL) {
  const redis = getRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Kairos Chess Coaching App (contact@kairos.app)',
    },
    timeout: 15000,
  });

  if (!res.ok) {
    if (res.status === 404) {
      const err = new Error(`Chess.com user not found`);
      err.statusCode = 404;
      throw err;
    }
    if (res.status === 429) {
      const err = new Error('Chess.com API rate limit hit. Try again shortly.');
      err.statusCode = 429;
      throw err;
    }
    throw new Error(`Chess.com API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  await redis.setex(cacheKey, ttl, JSON.stringify(data));
  return data;
}

async function validateUser(username) {
  try {
    const data = await fetchWithCache(
      `${BASE_URL}/player/${username}`,
      `chesscom:profile:${username.toLowerCase()}`,
      300
    );
    return {
      username: data.username,
      name: data.name,
      avatar: data.avatar,
      country: data.country,
      joinedAt: new Date(data.joined * 1000).toISOString(),
    };
  } catch (err) {
    if (err.statusCode === 404) {
      const e = new Error(`Chess.com username "${username}" not found`);
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

async function getPlayerStats(username) {
  const data = await fetchWithCache(
    `${BASE_URL}/player/${username}/stats`,
    `chesscom:stats:${username.toLowerCase()}`,
    1800
  );

  const extractRating = (category) => data[category]?.last?.rating || null;

  return {
    bullet: extractRating('chess_bullet'),
    blitz: extractRating('chess_blitz'),
    rapid: extractRating('chess_rapid'),
    classical: extractRating('chess_daily'),
  };
}

async function getGameArchives(username) {
  const data = await fetchWithCache(
    `${BASE_URL}/player/${username}/games/archives`,
    `chesscom:archives:${username.toLowerCase()}`,
    3600
  );
  return data.archives || [];
}

async function getGamesFromArchive(archiveUrl) {
  const cacheKey = `chesscom:archive:${archiveUrl.split('/').slice(-2).join('-')}`;
  const redis = getRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const res = await fetch(archiveUrl, {
    headers: {
      'User-Agent': 'Kairos Chess Coaching App (contact@kairos.app)',
    },
    timeout: 30000,
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch archive: ${archiveUrl} (${res.status})`);
  }

  const data = await res.json();
  const games = data.games || [];

  const isCurrentMonth = archiveUrl.endsWith(
    `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}`
  );

  if (!isCurrentMonth && games.length > 0) {
    await redis.setex(cacheKey, 86400 * 7, JSON.stringify(games));
  }

  return games;
}

function normalizeGame(rawGame, username) {
  const headers = parseChessComHeaders(rawGame.pgn);
  const userIsWhite =
    rawGame.white?.username?.toLowerCase() === username.toLowerCase();
  const userColor = userIsWhite ? 'white' : 'black';

  const whiteResult = rawGame.white?.result;
  const blackResult = rawGame.black?.result;
  const userResultRaw = userIsWhite ? whiteResult : blackResult;

  let userResult = 'draw';
  if (userResultRaw === 'win') userResult = 'win';
  else if (['checkmated', 'resigned', 'timeout', 'abandoned', 'lose'].includes(userResultRaw)) {
    userResult = 'loss';
  }

  let pgn_result = '1/2-1/2';
  if (whiteResult === 'win') pgn_result = '1-0';
  else if (blackResult === 'win') pgn_result = '0-1';

  const timeClass = mapTimeClass(rawGame.time_class);

  return {
    platform: 'chess.com',
    platform_game_id: String(rawGame.uuid || rawGame.url?.split('/').pop()),
    pgn: rawGame.pgn,
    white_username: rawGame.white?.username || '',
    black_username: rawGame.black?.username || '',
    user_color: userColor,
    time_control: rawGame.time_control,
    time_class: timeClass,
    result: pgn_result,
    user_result: userResult,
    user_rating: userIsWhite ? rawGame.white?.rating : rawGame.black?.rating,
    opponent_rating: userIsWhite ? rawGame.black?.rating : rawGame.white?.rating,
    opening_eco: headers.ECO || null,
    opening_name: headers.Opening || null,
    termination: headers.Termination || null,
    played_at: new Date(rawGame.end_time * 1000).toISOString(),
  };
}

function mapTimeClass(raw) {
  const map = {
    bullet: 'bullet',
    blitz: 'blitz',
    rapid: 'rapid',
    daily: 'classical',
    classical: 'classical',
  };
  return map[raw] || 'unknown';
}

function parseChessComHeaders(pgn) {
  const headers = {};
  const regex = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  while ((match = regex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}

async function fetchRecentGames(username, sinceTimestamp = null) {
  const archives = await getGameArchives(username);

  const relevantArchives = sinceTimestamp
    ? filterArchivesSince(archives, sinceTimestamp)
    : archives.slice(-3);

  const allGames = [];

  for (const archiveUrl of relevantArchives) {
    try {
      const games = await getGamesFromArchive(archiveUrl);
      const filtered = sinceTimestamp
        ? games.filter((g) => g.end_time * 1000 > sinceTimestamp)
        : games;
      allGames.push(...filtered);
      await sleep(150);
    } catch (err) {
      logger.warn('Failed to fetch archive', { archiveUrl, error: err.message });
    }
  }

  return allGames;
}

function filterArchivesSince(archives, sinceTimestamp) {
  const sinceDate = new Date(sinceTimestamp);
  const sinceYear = sinceDate.getFullYear();
  const sinceMonth = sinceDate.getMonth() + 1;

  return archives.filter((url) => {
    const parts = url.split('/');
    const year = parseInt(parts[parts.length - 2], 10);
    const month = parseInt(parts[parts.length - 1], 10);
    return year > sinceYear || (year === sinceYear && month >= sinceMonth);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  validateUser,
  getPlayerStats,
  fetchRecentGames,
  normalizeGame,
};
