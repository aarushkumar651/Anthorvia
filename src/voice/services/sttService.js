/**
 * SPEECH-TO-TEXT SERVICE
 * 
 * Future integration points:
 * - Deepgram Nova-2 (recommended for low latency, Indian English support)
 * - OpenAI Whisper (higher accuracy, higher latency)
 * 
 * How it will work:
 * 1. Mobile app streams audio chunks via WebSocket
 * 2. This service receives raw audio buffer
 * 3. Forwards to STT provider
 * 4. Returns transcript (interim + final)
 * 5. Final transcript goes to AI coach for response
 */

const voiceConfig = require('../config/voiceConfig');
const logger = require('../../config/logger');

class STTService {
  constructor() {
    this.provider = voiceConfig.stt.provider;
    this.activeConnections = new Map(); // sessionId -> STT connection
  }

  /**
   * Initialize a streaming STT connection for a voice session.
   * Call this when user starts speaking.
   * 
   * @param {string} sessionId - Voice session ID
   * @param {Function} onTranscript - Callback: (text, isFinal) => void
   * @param {Function} onError - Callback: (error) => void
   */
  async startStream(sessionId, onTranscript, onError) {
    if (this.provider === 'deepgram') {
      return this._startDeepgramStream(sessionId, onTranscript, onError);
    }
    if (this.provider === 'openai-whisper') {
      return this._startWhisperBuffer(sessionId, onTranscript, onError);
    }
    throw new Error(`Unsupported STT provider: ${this.provider}`);
  }

  /**
   * Send audio chunk to active STT stream.
   * Audio format expected: PCM 16-bit, 16kHz, mono
   * 
   * @param {string} sessionId
   * @param {Buffer} audioChunk
   */
  async sendAudioChunk(sessionId, audioChunk) {
    const connection = this.activeConnections.get(sessionId);
    if (!connection) {
      logger.warn('STT: No active stream for session', { sessionId });
      return;
    }

    // FUTURE IMPLEMENTATION:
    // connection.send(audioChunk);
    logger.debug('STT: Audio chunk received', {
      sessionId,
      bytes: audioChunk.length,
      provider: this.provider,
    });
  }

  /**
   * Stop STT stream for a session.
   * @param {string} sessionId
   */
  async stopStream(sessionId) {
    const connection = this.activeConnections.get(sessionId);
    if (connection) {
      // FUTURE: connection.finish();
      this.activeConnections.delete(sessionId);
      logger.info('STT: Stream stopped', { sessionId });
    }
  }

  /**
   * FUTURE: Deepgram live streaming implementation
   * 
   * Will use: @deepgram/sdk
   * const { createClient } = require('@deepgram/sdk');
   * const deepgram = createClient(voiceConfig.stt.deepgram.apiKey);
   * const connection = deepgram.listen.live({ model: 'nova-2', language: 'en-IN', ... });
   */
  async _startDeepgramStream(sessionId, onTranscript, onError) {
    // PLACEHOLDER — implement when DEEPGRAM_API_KEY is set
    logger.info('STT: Deepgram stream would start here', { sessionId });

    // Simulate storing connection reference
    this.activeConnections.set(sessionId, {
      provider: 'deepgram',
      startedAt: new Date(),
    });
  }

  /**
   * FUTURE: OpenAI Whisper batch implementation
   * Whisper doesn't support true streaming — buffers audio then transcribes.
   * 
   * Will use: openai.audio.transcriptions.create({ file, model: 'whisper-1' })
   */
  async _startWhisperBuffer(sessionId, onTranscript, onError) {
    // PLACEHOLDER — implement when ready
    logger.info('STT: Whisper buffer would start here', { sessionId });

    this.activeConnections.set(sessionId, {
      provider: 'whisper',
      audioBuffer: [],
      startedAt: new Date(),
    });
  }

  /**
   * One-shot transcription for uploaded audio files.
   * Useful for voice message feature.
   * 
   * @param {Buffer} audioBuffer
   * @param {string} mimeType - 'audio/webm', 'audio/mp4', etc.
   * @returns {Promise<string>} - Transcript text
   */
  async transcribeAudioFile(audioBuffer, mimeType = 'audio/webm') {
    // FUTURE IMPLEMENTATION:
    // const openai = require('../../services/aiService').getOpenAIClient();
    // const transcript = await openai.audio.transcriptions.create({
    //   file: new File([audioBuffer], 'audio.webm', { type: mimeType }),
    //   model: 'whisper-1',
    //   language: 'en',
    // });
    // return transcript.text;

    logger.info('STT: File transcription placeholder called');
    throw new Error('Voice feature not yet implemented. Coming soon!');
  }
}

module.exports = new STTService();
