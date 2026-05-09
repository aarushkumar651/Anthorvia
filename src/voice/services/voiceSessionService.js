/**
 * VOICE SESSION SERVICE
 * 
 * Manages lifecycle of a voice conversation:
 * start → STT stream → AI processing → TTS stream → end
 * 
 * Each voice session is separate from text chat sessions
 * but can reference the same chat session for memory/context.
 */

const { v4: uuidv4 } = require('uuid');
const { query } = require('../../config/database');
const { getRedis } = require('../../config/redis');
const voiceConfig = require('../config/voiceConfig');
const logger = require('../../config/logger');

const SESSION_TTL_SECONDS = 3600; // 1 hour max

class VoiceSessionService {

  /**
   * Create a new voice session.
   * Called when user taps the microphone button.
   * 
   * @param {string} userId
   * @param {string} plan - User's subscription plan
   * @param {string|null} chatSessionId - Link to existing text chat session
   * @returns {object} - Session info
   */
  async createSession(userId, plan, chatSessionId = null) {
    const limits = voiceConfig.sessionLimits[plan] || voiceConfig.sessionLimits.free;

    // FUTURE: Check daily session count against limits
    // const dailyCount = await this._getDailySessionCount(userId);
    // if (dailyCount >= limits.maxSessionsPerDay) {
    //   throw Object.assign(new Error('Daily voice session limit reached'), { statusCode: 403 });
    // }

    const sessionId = uuidv4();
    const sessionData = {
      sessionId,
      userId,
      plan,
      chatSessionId,
      status: 'active', // 'active' | 'ended' | 'error'
      startedAt: new Date().toISOString(),
      maxDurationSeconds: limits.maxDurationSeconds,
      audioChunksReceived: 0,
      transcripts: [],
    };

    // Store session in Redis for fast access during WebSocket communication
    const redis = getRedis();
    await redis.setex(
      `voice:session:${sessionId}`,
      SESSION_TTL_SECONDS,
      JSON.stringify(sessionData)
    );

    logger.info('Voice session created', { sessionId, userId, plan });

    return {
      sessionId,
      maxDurationSeconds: limits.maxDurationSeconds,
      provider: {
        stt: voiceConfig.stt.provider,
        tts: voiceConfig.tts.provider,
      },
    };
  }

  /**
   * Get active voice session from Redis.
   * @param {string} sessionId
   */
  async getSession(sessionId) {
    const redis = getRedis();
    const raw = await redis.get(`voice:session:${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  /**
   * Update session data in Redis.
   * @param {string} sessionId
   * @param {object} updates
   */
  async updateSession(sessionId, updates) {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const updated = { ...session, ...updates };
    const redis = getRedis();
    const ttl = await redis.ttl(`voice:session:${sessionId}`);
    await redis.setex(`voice:session:${sessionId}`, Math.max(ttl, 60), JSON.stringify(updated));
    return updated;
  }

  /**
   * End a voice session and save summary to DB.
   * @param {string} sessionId
   * @param {string} reason - 'user_ended' | 'timeout' | 'error'
   */
  async endSession(sessionId, reason = 'user_ended') {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const endedAt = new Date();
    const durationSeconds = Math.round(
      (endedAt - new Date(session.startedAt)) / 1000
    );

    // FUTURE: Save to DB for analytics
    // await query(
    //   `INSERT INTO voice_sessions (id, user_id, chat_session_id, duration_seconds, transcript_count, ended_reason, started_at, ended_at)
    //    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    //   [sessionId, session.userId, session.chatSessionId, durationSeconds, session.transcripts.length, reason, session.startedAt, endedAt]
    // );

    const redis = getRedis();
    await redis.del(`voice:session:${sessionId}`);

    logger.info('Voice session ended', { sessionId, durationSeconds, reason });

    return { sessionId, durationSeconds, reason };
  }

  /**
   * Check if session has exceeded max duration.
   * @param {string} sessionId
   */
  async isSessionExpired(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) return true;

    const durationSeconds = Math.round(
      (Date.now() - new Date(session.startedAt).getTime()) / 1000
    );

    return durationSeconds >= session.maxDurationSeconds;
  }
}

module.exports = new VoiceSessionService();
