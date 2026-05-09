/**
 * VOICE CONFIGURATION
 * 
 * Supported providers:
 * STT: Deepgram, OpenAI Whisper
 * TTS: ElevenLabs, Cartesia, OpenAI TTS
 * Realtime: OpenAI Realtime API, Deepgram Agent
 * 
 * Set active providers via environment variables.
 */

const voiceConfig = {
  // Speech-to-Text provider
  stt: {
    provider: process.env.STT_PROVIDER || 'deepgram', // 'deepgram' | 'openai-whisper'
    deepgram: {
      apiKey: process.env.DEEPGRAM_API_KEY,
      model: process.env.DEEPGRAM_MODEL || 'nova-2',
      language: process.env.DEEPGRAM_LANGUAGE || 'en-IN',
      punctuate: true,
      interimResults: true,  // For real-time streaming
      endpointing: 500,      // ms of silence before finalizing
    },
    whisper: {
      // Uses existing OPENAI_API_KEY from env
      model: 'whisper-1',
    },
  },

  // Text-to-Speech provider
  tts: {
    provider: process.env.TTS_PROVIDER || 'elevenlabs', // 'elevenlabs' | 'cartesia' | 'openai'
    elevenlabs: {
      apiKey: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Default: Adam
      modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
      outputFormat: 'mp3_44100_128',
      streamingLatencyOptimization: 4, // 0-4, higher = lower latency
    },
    cartesia: {
      apiKey: process.env.CARTESIA_API_KEY,
      voiceId: process.env.CARTESIA_VOICE_ID,
      modelId: 'sonic-english',
      outputFormat: {
        container: 'raw',
        encoding: 'pcm_f32le',
        sampleRate: 44100,
      },
    },
    openai: {
      // Uses existing OPENAI_API_KEY
      model: 'tts-1',
      voice: process.env.OPENAI_TTS_VOICE || 'alloy',
      responseFormat: 'mp3',
    },
  },

  // OpenAI Realtime API (WebRTC/WebSocket based end-to-end)
  realtime: {
    enabled: process.env.OPENAI_REALTIME_ENABLED === 'true' || false,
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-realtime-preview',
    voice: 'alloy',
  },

  // WebSocket settings
  websocket: {
    path: '/voice',
    maxPayloadMB: 5,
    pingInterval: 30000,
    pingTimeout: 10000,
  },

  // Voice session limits per plan
  sessionLimits: {
    free: {
      maxDurationSeconds: 60,
      maxSessionsPerDay: 3,
    },
    basic: {
      maxDurationSeconds: 300,
      maxSessionsPerDay: 20,
    },
    pro: {
      maxDurationSeconds: 1800,
      maxSessionsPerDay: 100,
    },
  },
};

module.exports = voiceConfig;
