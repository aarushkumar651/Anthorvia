const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const voiceConfig = require('../config/voiceConfig');
const logger = require('../../config/logger');

class STTService {
  constructor() {
    this.provider = voiceConfig.stt.provider;
    this.activeConnections = new Map();
    this.deepgram = null;
  }

  _getDeepgramClient() {
    if (!this.deepgram) {
      if (!voiceConfig.stt.deepgram.apiKey) {
        throw new Error('DEEPGRAM_API_KEY is not set');
      }
      this.deepgram = createClient(voiceConfig.stt.deepgram.apiKey);
    }
    return this.deepgram;
  }

  async startStream(sessionId, onTranscript, onError) {
    if (this.provider === 'deepgram') {
      return this._startDeepgramStream(sessionId, onTranscript, onError);
    }
    throw new Error(`Unsupported STT provider: ${this.provider}`);
  }

  async _startDeepgramStream(sessionId, onTranscript, onError) {
    try {
      const client = this._getDeepgramClient();

      const connection = client.listen.live({
        model: voiceConfig.stt.deepgram.model,
        language: voiceConfig.stt.deepgram.language,
        punctuate: voiceConfig.stt.deepgram.punctuate,
        interim_results: voiceConfig.stt.deepgram.interimResults,
        endpointing: voiceConfig.stt.deepgram.endpointing,
        smart_format: true,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
      });

      connection.on(LiveTranscriptionEvents.Open, () => {
        logger.info('STT: Deepgram connection opened', { sessionId });
      });

      connection.on(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (!transcript) return;

        const isFinal = data.is_final === true;
        const speechFinal = data.speech_final === true;

        logger.debug('STT: Transcript received', {
          sessionId,
          text: transcript,
          isFinal,
          speechFinal,
        });

        onTranscript(transcript, isFinal || speechFinal);
      });

      connection.on(LiveTranscriptionEvents.Error, (err) => {
        logger.error('STT: Deepgram error', { sessionId, error: err.message });
        if (onError) onError(err);
      });

      connection.on(LiveTranscriptionEvents.Close, () => {
        logger.info('STT: Deepgram connection closed', { sessionId });
        this.activeConnections.delete(sessionId);
      });

      this.activeConnections.set(sessionId, connection);

      logger.info('STT: Deepgram stream started', { sessionId });
    } catch (err) {
      logger.error('STT: Failed to start Deepgram stream', { sessionId, error: err.message });
      if (onError) onError(err);
    }
  }

  async sendAudioChunk(sessionId, audioChunk) {
    const connection = this.activeConnections.get(sessionId);
    if (!connection) {
      logger.warn('STT: No active stream for session', { sessionId });
      return;
    }

    try {
      connection.send(audioChunk);
    } catch (err) {
      logger.error('STT: Failed to send audio chunk', { sessionId, error: err.message });
    }
  }

  async stopStream(sessionId) {
    const connection = this.activeConnections.get(sessionId);
    if (connection) {
      try {
        connection.requestClose();
      } catch {}
      this.activeConnections.delete(sessionId);
      logger.info('STT: Stream stopped', { sessionId });
    }
  }

  async transcribeAudioFile(audioBuffer, mimeType = 'audio/webm') {
    const client = this._getDeepgramClient();

    const { result, error } = await client.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        model: voiceConfig.stt.deepgram.model,
        language: voiceConfig.stt.deepgram.language,
        punctuate: true,
        smart_format: true,
        mimetype: mimeType,
      }
    );

    if (error) throw new Error(`Deepgram transcription error: ${error.message}`);

    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (!transcript) throw new Error('No transcript returned from Deepgram');

    return transcript;
  }
}

module.exports = new STTService();
