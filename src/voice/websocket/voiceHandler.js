/**
 * VOICE WEBSOCKET HANDLER
 * 
 * Handles real-time voice communication between mobile app and backend.
 * 
 * Message flow:
 * Client → { type: 'audio_chunk', data: <base64 audio> }
 * Server → { type: 'transcript', text: '...', isFinal: true }
 * Server → { type: 'ai_text', text: '...' }
 * Server → { type: 'audio_chunk', data: <base64 audio> }
 * Server → { type: 'session_ended', reason: '...' }
 * 
 * Message types from client:
 * - 'start_session'   → Begin voice session
 * - 'audio_chunk'     → Raw audio data (base64 encoded)
 * - 'end_session'     → User stopped speaking / ended call
 * - 'ping'            → Keep-alive
 * 
 * Message types to client:
 * - 'session_ready'   → Session created, ready to receive audio
 * - 'transcript'      → STT result (interim or final)
 * - 'ai_text'         → AI coach text response
 * - 'audio_chunk'     → TTS audio chunk (base64)
 * - 'audio_done'      → TTS finished for this turn
 * - 'error'           → Error occurred
 * - 'session_ended'   → Session terminated
 * - 'pong'            → Keep-alive response
 */

const jwt = require('jsonwebtoken');
const { config } = require('../../config/env');
const voiceSessionService = require('../services/voiceSessionService');
const sttService = require('../services/sttService');
const ttsService = require('../services/ttsService');
const { query } = require('../../config/database');
const logger = require('../../config/logger');

/**
 * Authenticate WebSocket connection via JWT token.
 * Token passed as query param: ws://server/voice?token=<jwt>
 */
async function authenticateWsConnection(request) {
  try {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) return null;

    const decoded = jwt.verify(token, config.jwt.secret);

    const result = await query(
      `SELECT u.id, u.name, u.chess_com_username, s.plan, s.status
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) return null;

    const user = result.rows[0];
    const isActive = user.status === 'trialing' || user.status === 'active';

    return isActive ? user : null;
  } catch {
    return null;
  }
}

/**
 * Send JSON message to WebSocket client safely.
 */
function sendMessage(ws, type, payload = {}) {
  if (ws.readyState === 1) { // OPEN
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

/**
 * Main WebSocket connection handler.
 * Attach to WebSocket server in voice/websocket/index.js
 * 
 * @param {WebSocket} ws
 * @param {http.IncomingMessage} request
 */
async function handleVoiceConnection(ws, request) {
  logger.info('Voice WebSocket: New connection attempt');

  // Authenticate
  const user = await authenticateWsConnection(request);

  if (!user) {
    sendMessage(ws, 'error', { message: 'Unauthorized. Provide a valid JWT token.' });
    ws.close(1008, 'Unauthorized');
    return;
  }

  logger.info('Voice WebSocket: Authenticated', { userId: user.id });

  let activeSessionId = null;

  // Handle incoming messages
  ws.on('message', async (rawData) => {
    try {
      const message = JSON.parse(rawData.toString());

      switch (message.type) {

        case 'ping':
          sendMessage(ws, 'pong');
          break;

        case 'start_session': {
          if (activeSessionId) {
            sendMessage(ws, 'error', { message: 'Session already active' });
            break;
          }

          await sttService.startStream(
  activeSessionId,
  async (transcript, isFinal) => {
    sendMessage(ws, 'transcript', { text: transcript, isFinal });
    if (isFinal && transcript.trim()) {
      await processTurnAndRespond(ws, user, activeSessionId, transcript);
    }
  },
  (error) => sendMessage(ws, 'error', { message: error.message })
);

          const session = await voiceSessionService.createSession(
            user.id,
            user.plan,
            message.chatSessionId || null
          );

          activeSessionId = session.sessionId;

          sendMessage(ws, 'session_ready', {
            sessionId: activeSessionId,
            maxDurationSeconds: session.maxDurationSeconds,
            message: 'Voice session ready. Voice feature coming soon!',
          });

          logger.info('Voice session started', { sessionId: activeSessionId, userId: user.id });
          break;
        }

        case 'audio_chunk': {
          if (!activeSessionId) {
            sendMessage(ws, 'error', { message: 'No active session. Send start_session first.' });
            break;
          }

          // Check session expiry
          const expired = await voiceSessionService.isSessionExpired(activeSessionId);
          if (expired) {
            sendMessage(ws, 'session_ended', { reason: 'timeout' });
            await voiceSessionService.endSession(activeSessionId, 'timeout');
            activeSessionId = null;
            break;
          }

          const audioBuffer = Buffer.from(message.data, 'base64');
await sttService.sendAudioChunk(activeSessionId, audioBuffer);
          // Update chunk count
          await voiceSessionService.updateSession(activeSessionId, {
            audioChunksReceived: ((await voiceSessionService.getSession(activeSessionId))?.audioChunksReceived || 0) + 1,
          });
          break;
        }

        case 'end_session': {
          if (activeSessionId) {
            await sttService.stopStream(activeSessionId);
            const result = await voiceSessionService.endSession(activeSessionId, 'user_ended');
            sendMessage(ws, 'session_ended', { reason: 'user_ended', ...result });
            activeSessionId = null;
          }
          break;
        }

        default:
          sendMessage(ws, 'error', { message: `Unknown message type: ${message.type}` });
      }

    } catch (err) {
      logger.error('Voice WebSocket: Message handling error', { error: err.message });
      sendMessage(ws, 'error', { message: 'Failed to process message' });
    }
  });

  // Handle connection close
  ws.on('close', async (code, reason) => {
    logger.info('Voice WebSocket: Connection closed', { userId: user.id, code });
    if (activeSessionId) {
      await sttService.stopStream(activeSessionId).catch(() => {});
      await voiceSessionService.endSession(activeSessionId, 'connection_closed').catch(() => {});
    }
  });

  ws.on('error', (err) => {
    logger.error('Voice WebSocket: Connection error', { userId: user.id, error: err.message });
  });
}

async function processTurnAndRespond(ws, user, sessionId, transcript) {
  try {
    logger.info('Voice: Processing turn', { sessionId, transcript });

    const { chat } = require('../../services/aiService');

    sendMessage(ws, 'ai_text_start');

    let fullAiText = '';

    const { response } = await chat(
      user,
      transcript,
      null,
      null,
      (chunk) => {
        fullAiText += chunk;
        sendMessage(ws, 'ai_text_chunk', { text: chunk });
      }
    );

    sendMessage(ws, 'ai_text_done', { text: fullAiText });

    sendMessage(ws, 'audio_start');

    await ttsService.streamSpeech(
      fullAiText,
      (audioChunk) => {
        sendMessage(ws, 'audio_chunk', {
          data: audioChunk.toString('base64'),
        });
      },
      () => {
        sendMessage(ws, 'audio_done');
        logger.info('Voice: Turn complete', { sessionId });
      }
    );
  } catch (err) {
    logger.error('Voice: Turn processing error', { sessionId, error: err.message });
    sendMessage(ws, 'error', { message: 'Failed to process voice turn' });
  }
}

module.exports = { handleVoiceConnection };
