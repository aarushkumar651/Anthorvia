const Groq = require('groq-sdk');
const { query } = require('../config/database');
const { config } = require('../config/env');
const { buildCoachSystemPrompt, buildGameAnalysisPrompt } = require('../prompts/coachSystem');
const { retrieveRelevantMemories } = require('./memoryService');
const logger = require('../config/logger');

const groq = new Groq({ apiKey: config.groq.apiKey });

async function getWeeklyStats(userId) {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE played_at >= NOW() - INTERVAL '7 days') AS games_played,
       ROUND(
         COUNT(*) FILTER (WHERE played_at >= NOW() - INTERVAL '7 days' AND user_result = 'win') * 100.0 /
         NULLIF(COUNT(*) FILTER (WHERE played_at >= NOW() - INTERVAL '7 days'), 0),
         1
       ) AS win_rate,
       ROUND(AVG(ga.accuracy_score) FILTER (WHERE g.played_at >= NOW() - INTERVAL '7 days'), 1) AS avg_accuracy,
       ROUND(AVG(ga.blunder_count) FILTER (WHERE g.played_at >= NOW() - INTERVAL '7 days'), 2) AS blunders_per_game
     FROM games g
     LEFT JOIN game_analyses ga ON ga.game_id = g.id
     WHERE g.user_id = $1`,
    [userId]
  );

  const row = result.rows[0];
  return {
    gamesPlayed: parseInt(row.games_played, 10) || 0,
    winRate: parseFloat(row.win_rate) || 0,
    avgAccuracy: parseFloat(row.avg_accuracy) || 0,
    blundersPerGame: parseFloat(row.blunders_per_game) || 0,
    streak: 0,
  };
}

async function getChatHistory(sessionId, limit = 12) {
  const result = await query(
    `SELECT role, content FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [sessionId, limit]
  );
  return result.rows.map((r) => ({ role: r.role, content: r.content }));
}

async function getGameContext(gameId, userId) {
  const gameResult = await query(
    `SELECT g.*, ga.*
     FROM games g
     LEFT JOIN game_analyses ga ON ga.game_id = g.id
     WHERE g.id = $1 AND g.user_id = $2`,
    [gameId, userId]
  );

  if (gameResult.rows.length === 0) return null;

  const row = gameResult.rows[0];
  return buildGameAnalysisPrompt(row, row, row.user_color);
}

async function createOrGetSession(userId, sessionId, gameId) {
  if (sessionId) {
    const existing = await query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    if (existing.rows.length > 0) return sessionId;
  }

  const result = await query(
    `INSERT INTO chat_sessions (user_id, context_game_id, title)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, gameId || null, 'New Session']
  );

  return result.rows[0].id;
}

async function saveMessages(sessionId, userId, userMessage, aiResponse, tokensUsed) {
  await query(
    `INSERT INTO chat_messages (session_id, user_id, role, content)
     VALUES ($1, $2, 'user', $3), ($1, $2, 'assistant', $4)`,
    [sessionId, userId, userMessage, aiResponse]
  );

  await query(
    `INSERT INTO usage_logs (user_id, action, tokens_used)
     VALUES ($1, 'ai_chat', $2)`,
    [userId, tokensUsed]
  );

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await query(
    `INSERT INTO usage_monthly (user_id, month, ai_chat_count, total_tokens_used)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (user_id, month) DO UPDATE
     SET ai_chat_count = usage_monthly.ai_chat_count + 1,
         total_tokens_used = usage_monthly.total_tokens_used + EXCLUDED.total_tokens_used`,
    [userId, month, tokensUsed]
  );
}

async function updateSessionTitle(sessionId, userMessage) {
  try {
    const titleRes = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'user',
          content: `Generate a concise 3-5 word title for a chess coaching conversation that starts with: "${userMessage.slice(0, 100)}". Return ONLY the title, nothing else.`,
        },
      ],
      max_tokens: 20,
      temperature: 0.3,
    });

    const title = titleRes.choices[0]?.message?.content?.trim() || 'Chess Session';
    await query('UPDATE chat_sessions SET title = $1 WHERE id = $2', [title, sessionId]);
  } catch {
    // Non-critical
  }
}

async function chat(user, userMessage, sessionId, gameId, streamCallback) {
  const resolvedSessionId = await createOrGetSession(user.id, sessionId, gameId);

  const [memories, weeklyStats, chatHistory, gameContext] = await Promise.all([
    retrieveRelevantMemories(user.id, userMessage),
    getWeeklyStats(user.id),
    getChatHistory(resolvedSessionId),
    gameId ? getGameContext(gameId, user.id) : Promise.resolve(null),
  ]);

  const systemPrompt = buildCoachSystemPrompt(user, memories, weeklyStats);

  const messages = [{ role: 'system', content: systemPrompt }];

  if (gameContext) {
    messages.push({ role: 'system', content: gameContext });
  }

  messages.push(...chatHistory);
  messages.push({ role: 'user', content: userMessage });

  let fullResponse = '';
  let tokensUsed = 0;

  try {
    const stream = await groq.chat.completions.create({
      model: config.groq.model,
      messages,
      max_tokens: config.groq.maxTokens,
      temperature: 0.72,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        fullResponse += text;
        if (streamCallback) streamCallback(text);
      }

      if (chunk.usage) {
        tokensUsed = chunk.usage.total_tokens;
      }
    }

    if (!tokensUsed) {
      tokensUsed = Math.ceil((systemPrompt.length + userMessage.length + fullResponse.length) / 4);
    }

    await saveMessages(resolvedSessionId, user.id, userMessage, fullResponse, tokensUsed);

    if (chatHistory.length === 0) {
      updateSessionTitle(resolvedSessionId, userMessage).catch(() => {});
    }

    return {
      response: fullResponse,
      sessionId: resolvedSessionId,
      tokensUsed,
    };
  } catch (err) {
    logger.error('AI chat error', { userId: user.id, error: err.message });
    throw new Error('AI coach is temporarily unavailable. Please try again.');
  }
}

async function generateCoachComment(phase, moveEvals, userColor) {
  const relevantMoves = moveEvals.filter((m) => {
    const n = m.moveNumber;
    if (phase === 'opening') return n <= 15;
    if (phase === 'middlegame') return n > 15 && n <= 35;
    return n > 35;
  });

  if (relevantMoves.length === 0) return null;

  const blunders = relevantMoves.filter((m) => m.classification === 'blunder');
  const mistakes = relevantMoves.filter((m) => m.classification === 'mistake');
  const avgLoss =
    relevantMoves.reduce((a, b) => a + (b.evalLoss || 0), 0) / relevantMoves.length;

  const prompt = `As a chess coach, write a 1-2 sentence comment about a player's ${phase} performance.
Data: ${blunders.length} blunders, ${mistakes.length} mistakes, average eval loss: ${avgLoss.toFixed(1)} centipawns.
${blunders.length > 0 ? `Worst blunder at move ${blunders[0].moveNumber}: played ${blunders[0].san} (lost ${blunders[0].evalLoss?.toFixed(0)} cp).` : ''}
Be specific and actionable. Do not be generic. Max 60 words.`;

  try {
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.6,
    });
    return res.choices[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

module.exports = { chat, generateCoachComment, getWeeklyStats };
