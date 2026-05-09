/**
 * OPENAI REALTIME API SERVICE
 * 
 * OpenAI Realtime enables end-to-end voice conversations:
 * Audio in → GPT-4o processes → Audio out (no separate STT/TTS needed)
 * 
 * This is the PREMIUM voice mode for Anthorvia Pro users.
 * 
 * Future integration:
 * - WebRTC (browser/mobile) or WebSocket connection to OpenAI
 * - Function calling for chess move lookups mid-conversation
 * - Interruption handling (user can interrupt AI mid-sentence)
 */

const voiceConfig = require('../config/voiceConfig');
const logger = require('../../config/logger');

class RealtimeService {

  /**
   * Create an ephemeral token for client-side OpenAI Realtime connection.
   * Mobile app uses this token to connect DIRECTLY to OpenAI Realtime API.
   * This avoids routing audio through our server (lower latency, cheaper).
   * 
   * @param {string} userId
   * @param {object} coachContext - System prompt and user context
   * @returns {object} - { token, expiresAt }
   */
  async createEphemeralToken(userId, coachContext) {
    if (!voiceConfig.realtime.enabled) {
      throw Object.assign(
        new Error('Realtime voice is not enabled. Set OPENAI_REALTIME_ENABLED=true'),
        { statusCode: 503 }
      );
    }

    // FUTURE IMPLEMENTATION:
    // const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    //   method: 'POST',
    //   headers: {
    //     Authorization: `Bearer ${voiceConfig.realtime.apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     model: voiceConfig.realtime.model,
    //     voice: voiceConfig.realtime.voice,
    //     instructions: coachContext.systemPrompt,
    //     tools: [], // FUTURE: add chess analysis tools
    //     input_audio_format: 'pcm16',
    //     output_audio_format: 'pcm16',
    //     turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
    //   }),
    // });
    // const data = await response.json();
    // return { token: data.client_secret.value, expiresAt: data.client_secret.expires_at };

    logger.info('Realtime: Ephemeral token would be created here', { userId });

    return {
      token: null,
      message: 'OpenAI Realtime voice coming soon for Pro users',
      enabled: false,
    };
  }

  /**
   * Build system prompt for voice coach session.
   * Shorter and more conversational than text chat prompt.
   * 
   * @param {object} user
   * @param {Array} memories
   */
  buildVoiceSystemPrompt(user, memories = []) {
    const memoryStr = memories
      .slice(0, 5)
      .map((m) => `- ${m.content}`)
      .join('\n');

    return `You are the Anthorvia AI chess coach speaking with ${user.name}.
Keep responses SHORT — under 3 sentences. You are in a voice conversation.
Do not use markdown, bullet points, or symbols in responses.
Speak naturally like a real coach on a call.

What you know about this player:
${memoryStr || '- New player, no history yet'}

Be encouraging, specific, and concise. Always end with one clear action.`.trim();
  }
}

module.exports = new RealtimeService();
