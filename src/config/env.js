const requiredEnvVars = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
];

function validateEnv() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Check .env.example for required configuration.'
    );
  }
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  apiVersion: process.env.API_VERSION || 'v1',
  isProduction: process.env.NODE_ENV === 'production',

  db: {
    url: process.env.DATABASE_URL,
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },

  redis: {
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    maxTokens: parseInt(process.env.GROQ_MAX_TOKENS || '800', 10),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },

  plans: {
    basic: {
      amount: parseInt(process.env.PLAN_BASIC_AMOUNT || '9900', 10),
      razorpayPlanId: process.env.PLAN_BASIC_RAZORPAY_PLAN_ID,
    },
    pro: {
      amount: parseInt(process.env.PLAN_PRO_AMOUNT || '19900', 10),
      razorpayPlanId: process.env.PLAN_PRO_RAZORPAY_PLAN_ID,
    },
  },

  trial: {
    days: parseInt(process.env.TRIAL_DAYS || '10', 10),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    chatMax: parseInt(process.env.RATE_LIMIT_CHAT_MAX || '30', 10),
    analysisMax: parseInt(process.env.RATE_LIMIT_ANALYSIS_MAX || '20', 10),
  },

  stockfish: {
    depthByPlan: {
      free: parseInt(process.env.STOCKFISH_DEPTH_FREE || '14', 10),
      basic: parseInt(process.env.STOCKFISH_DEPTH_BASIC || '18', 10),
      pro: parseInt(process.env.STOCKFISH_DEPTH_PRO || '22', 10),
    },
  },

  queue: {
    concurrencyAnalysis: parseInt(process.env.QUEUE_CONCURRENCY_ANALYSIS || '4', 10),
    concurrencyFetch: parseInt(process.env.QUEUE_CONCURRENCY_FETCH || '3', 10),
    concurrencyReport: parseInt(process.env.QUEUE_CONCURRENCY_REPORT || '2', 10),
    concurrencyMemory: parseInt(process.env.QUEUE_CONCURRENCY_MEMORY || '3', 10),
  },

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
};

module.exports = { config, validateEnv };
