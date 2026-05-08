const OpenAI = require('openai');
const { query } = require('../config/database');
const { config } = require('../config/env');
const logger = require('../config/logger');
const { getRedis } = require('../config/redis');

const openai = new OpenAI({ apiKey: config.openai.apiKey });

async function embed(text) {
  const redis = getRedis();
  const cacheKey = `embed:${Buffer.from(text.slice(0, 200)).toString('base64')}`;

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const res = await openai.embeddings.create({
    model: config.openai.embeddingModel,
    input: text.slice(0, 8000),
  });

  const embedding = res.data[0].embedding;
  await redis.setex(cacheKey, 86400, JSON.stringify(embedding));
  return embedding;
}

async function storeMemory(userId, content, type, importance = 0.5, source = null) {
  try {
    const embedding = await embed(content);
    const embeddingStr = `[${embedding.join(',')}]`;

    const existing = await query(
      `SELECT id FROM user_memories WHERE user_id = $1 AND content = $2`,
      [userId, content]
    );

    if (existing.rows.length > 0) return existing.rows[0];

    const result = await query(
      `INSERT INTO user_memories (user_id, content, memory_type, embedding, importance_score, source)
       VALUES ($1, $2, $3, $4::vector, $5, $6)
       RETURNING id`,
      [userId, content, type, embeddingStr, importance, source]
    );

    return result.rows[0];
  } catch (err) {
    logger.warn('Failed to store memory', { userId, error: err.message });
    return null;
  }
}

async function retrieveRelevantMemories(userId, query_text, limit = 8) {
  try {
    const queryEmbedding = await embed(query_text);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const result = await query(
      `SELECT id, content, memory_type, importance_score,
              1 - (embedding <=> $2::vector) AS similarity
       FROM user_memories
       WHERE user_id = $1
         AND is_active = TRUE
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> $2::vector) > 0.68
       ORDER BY similarity DESC, importance_score DESC
       LIMIT $3`,
      [userId, embeddingStr, limit]
    );

    if (result.rows.length > 0) {
      const ids = result.rows.map((r) => r.id);
      query(
        `UPDATE user_memories SET access_count = access_count + 1, last_accessed_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [ids]
      ).catch(() => {});
    }

    return result.rows;
  } catch (err) {
    logger.warn('Memory retrieval failed', { userId, error: err.message });
    return [];
  }
}

async function extractAndStoreMemories(userId, userMessage, aiResponse) {
  const Groq = require('groq-sdk');
  const groq = new Groq({ apiKey: config.groq.apiKey });

  const prompt = `You are a memory extraction system for a chess coaching AI.

Extract important, long-term facts about the user from this conversation exchange.
Only extract facts that would be useful in future conversations: weaknesses, goals, preferences, improvements, personal context.
Do NOT extract generic chess facts. Only user-specific information.

User message: "${userMessage.slice(0, 500)}"
Coach response: "${aiResponse.slice(0, 500)}"

Return ONLY valid JSON in this exact format:
{"memories": [{"content": "concise fact about the user", "type": "weakness|preference|progress|fact|goal", "importance": 0.1}]}

If nothing notable, return: {"memories": []}`;

  try {
    const res = await groq.chat.completions.create({
      model: config.groq.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.1,
    });

    const raw = res.choices[0]?.message?.content || '{"memories":[]}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());

    if (Array.isArray(parsed.memories)) {
      for (const memory of parsed.memories.slice(0, 5)) {
        if (memory.content && memory.type && memory.importance) {
          await storeMemory(userId, memory.content, memory.type, memory.importance, 'chat');
        }
      }
    }
  } catch (err) {
    logger.debug('Memory extraction failed (non-critical)', { userId, error: err.message });
  }
}

async function seedInitialMemories(userId, userProfile, weaknesses, stats) {
  const memories = [];

  if (userProfile.chess_com_username) {
    memories.push({
      content: `User plays on Chess.com as ${userProfile.chess_com_username}`,
      type: 'fact',
      importance: 0.9,
    });
  }

  if (userProfile.lichess_username) {
    memories.push({
      content: `User plays on Lichess as ${userProfile.lichess_username}`,
      type: 'fact',
      importance: 0.9,
    });
  }

  if (stats.currentRating) {
    memories.push({
      content: `User's current ${stats.platform} ${stats.timeClass} rating is ${stats.currentRating}`,
      type: 'fact',
      importance: 0.8,
    });
  }

  for (const weakness of weaknesses.slice(0, 3)) {
    memories.push({
      content: `User has a recurring weakness: ${weakness.subcategory.replace(/_/g, ' ')} (occurred in ${weakness.occurrence_count} games)`,
      type: 'weakness',
      importance: 0.85,
    });
  }

  for (const memory of memories) {
    await storeMemory(userId, memory.content, memory.type, memory.importance, 'system');
  }
}

async function getUserMemories(userId, limit = 20) {
  const result = await query(
    `SELECT id, content, memory_type, importance_score, created_at, last_accessed_at
     FROM user_memories
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY importance_score DESC, last_accessed_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

async function deleteMemory(userId, memoryId) {
  const result = await query(
    `UPDATE user_memories SET is_active = FALSE
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [memoryId, userId]
  );
  return result.rows.length > 0;
}

module.exports = {
  embed,
  storeMemory,
  retrieveRelevantMemories,
  extractAndStoreMemories,
  seedInitialMemories,
  getUserMemories,
  deleteMemory,
};
