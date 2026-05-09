const { ElevenLabsClient } = require('elevenlabs');
const voiceConfig = require('../config/voiceConfig');
const logger = require('../../config/logger');

class TTSService {
  constructor() {
    this.provider = voiceConfig.tts.provider;
    this.client = null;
  }

  _getElevenLabsClient() {
    if (!this.client) {
      if (!voiceConfig.tts.elevenlabs.apiKey) {
        throw new Error('ELEVENLABS_API_KEY is not set');
      }
      this.client = new ElevenLabsClient({
        apiKey: voiceConfig.tts.elevenlabs.apiKey,
      });
    }
    return this.client;
  }

  async streamSpeech(text, onAudioChunk, onDone, options = {}) {
    if (!text || text.trim().length === 0) {
      if (onDone) onDone();
      return;
    }

    if (this.provider === 'elevenlabs') {
      return this._streamElevenLabs(text, onAudioChunk, onDone, options);
    }

    throw new Error(`Unsupported TTS provider: ${this.provider}`);
  }

  async _streamElevenLabs(text, onAudioChunk, onDone, options = {}) {
    const client = this._getElevenLabsClient();
    const voiceId = options.voiceId || voiceConfig.tts.elevenlabs.voiceId;
    const modelId = options.modelId || voiceConfig.tts.elevenlabs.modelId;

    logger.info('TTS: Starting ElevenLabs stream', {
      voiceId,
      modelId,
      textLength: text.length,
    });

    try {
      const audioStream = await client.textToSpeech.stream(voiceId, {
        text: text.trim(),
        model_id: modelId,
        output_format: voiceConfig.tts.elevenlabs.outputFormat,
        optimize_streaming_latency: voiceConfig.tts.elevenlabs.streamingLatencyOptimization,
        voice_settings: {
          stability: options.stability || 0.5,
          similarity_boost: options.similarityBoost || 0.75,
          style: options.style || 0.0,
          use_speaker_boost: true,
        },
      });

      for await (const chunk of audioStream) {
        if (chunk && onAudioChunk) {
          onAudioChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      }

      logger.info('TTS: Stream completed', { voiceId });

      if (onDone) onDone();
    } catch (err) {
      logger.error('TTS: ElevenLabs stream error', { error: err.message });
      throw err;
    }
  }

  async generateSpeechBuffer(text, options = {}) {
    const client = this._getElevenLabsClient();
    const voiceId = options.voiceId || voiceConfig.tts.elevenlabs.voiceId;

    const chunks = [];

    await this._streamElevenLabs(
      text,
      (chunk) => chunks.push(chunk),
      null,
      options
    );

    return Buffer.concat(chunks);
  }

  async getAvailableVoices() {
    try {
      const client = this._getElevenLabsClient();
      const response = await client.voices.getAll();

      const voices = (response.voices || []).map((v) => ({
        id: v.voice_id,
        name: v.name,
        category: v.category,
        description: v.description,
        previewUrl: v.preview_url,
        labels: v.labels,
      }));

      return { elevenlabs: voices, openai: [] };
    } catch (err) {
      logger.warn('TTS: Could not fetch voices', { error: err.message });
      return {
        elevenlabs: [
          { id: voiceConfig.tts.elevenlabs.voiceId, name: 'Default Coach Voice' },
        ],
        openai: [],
      };
    }
  }
}

module.exports = new TTSService();
