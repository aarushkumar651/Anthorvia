/**
 * VOICE REST API ROUTES
 * 
 * REST endpoints for voice feature setup.
 * Actual voice data travels via WebSocket (see voice/websocket/).
 * 
 * Routes:
 * POST /api/v1/voice/session       → Create voice session, get session ID
 * DELETE /api/v1/voice/session/:id → End voice session
 * GET  /api/v1/voice/voices        → List available TTS voices
 * POST /api/v1/voice/realtime-token → Get OpenAI Realtime ephemeral token (Pro only)
 * POST /api/v1/voice/transcribe    → Transcribe uploaded audio file
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { requireActiveSubscription, requirePlan } = require('../../middleware/subscriptionGate');
const voiceSessionService = require('../services/voiceSessionService');
const ttsService = require('../services/ttsService');
const realtimeService = require('../services/realtimeService');
const { retrieveRelevantMemories } = require('../../services/memoryService');
const { success, error, forbidden } = require('../../utils/response');

// Create a new voice session
router.post('/session', authenticate, requireActiveSubscription, async (req, res, next) => {
  try {
    const { chat_session_id } = req.body;

    const session = await voiceSessionService.createSession(
      req.user.id,
      req.user.plan,
      chat_session_id || null
    );

    return success(res, {
      ...session,
      websocket_url: `wss://anthorvia.up.railway.app/voice?token=<your-jwt>`,
      instructions: 'Connect to websocket_url with your JWT token, then send start_session message',
    }, 'Voice session created');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
});

// End a voice session
router.delete('/session/:sessionId', authenticate, async (req, res, next) => {
  try {
    const session = await voiceSessionService.getSession(req.params.sessionId);

    if (!session || session.userId !== req.user.id) {
      return error(res, 'Session not found', 404);
    }

    const result = await voiceSessionService.endSession(req.params.sessionId, 'user_ended');
    return success(res, result, 'Voice session ended');
  } catch (err) {
    next(err);
  }
});

// Get available TTS voices
router.get('/voices', authenticate, async (req, res, next) => {
  try {
    const voices = await ttsService.getAvailableVoices();
    return success(res, voices);
  } catch (err) {
    next(err);
  }
});

// Get OpenAI Realtime ephemeral token (Pro only)
router.post('/realtime-token', authenticate, requirePlan('pro'), async (req, res, next) => {
  try {
    const memories = await retrieveRelevantMemories(req.user.id, 'chess coaching session', 5);
    const systemPrompt = realtimeService.buildVoiceSystemPrompt(req.user, memories);
    const tokenData = await realtimeService.createEphemeralToken(req.user.id, { systemPrompt });

    return success(res, tokenData, 'Realtime token generated');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
});

// Voice feature status
router.get('/status', authenticate, async (req, res) => {
  return success(res, {
    voice_enabled: false,
    websocket_ready: true,
    coming_soon: true,
    supported_providers: {
      stt: ['deepgram', 'openai-whisper'],
      tts: ['elevenlabs', 'cartesia', 'openai'],
      realtime: ['openai-realtime'],
    },
    your_plan: req.user.plan,
    message: 'Voice feature is coming soon for all plans!',
  });
});

module.exports = router;
