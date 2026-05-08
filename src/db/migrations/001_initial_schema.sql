-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  chess_com_username TEXT,
  lichess_username TEXT,
  rating_chess_com INTEGER,
  rating_lichess INTEGER,
  preferred_platform TEXT DEFAULT 'chess.com' CHECK (preferred_platform IN ('chess.com', 'lichess')),
  preferred_time_class TEXT DEFAULT 'blitz' CHECK (preferred_time_class IN ('bullet', 'blitz', 'rapid', 'classical')),
  coach_personality TEXT DEFAULT 'balanced' CHECK (coach_personality IN ('strict', 'encouraging', 'analytical', 'balanced')),
  onboarding_complete BOOLEAN DEFAULT FALSE,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_chess_com ON users(chess_com_username) WHERE chess_com_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_lichess ON users(lichess_username) WHERE lichess_username IS NOT NULL;

-- ─────────────────────────────────────────
-- REFRESH TOKENS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  device_info TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ─────────────────────────────────────────
-- SUBSCRIPTIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'pro')),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'cancelled', 'expired', 'past_due')),
  trial_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 days'),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  razorpay_subscription_id TEXT UNIQUE,
  razorpay_customer_id TEXT,
  amount_paise INTEGER,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay ON subscriptions(razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ─────────────────────────────────────────
-- PAYMENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_payment_id TEXT UNIQUE,
  razorpay_order_id TEXT,
  razorpay_subscription_id TEXT,
  amount_paise INTEGER NOT NULL,
  currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL CHECK (status IN ('created', 'captured', 'failed', 'refunded')),
  plan TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay ON payments(razorpay_payment_id);

-- ─────────────────────────────────────────
-- USAGE LOGS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('ai_chat', 'game_analysis', 'report_gen', 'opening_explore', 'training_plan')),
  tokens_used INTEGER DEFAULT 0,
  cost_usd NUMERIC(10, 6) DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_action ON usage_logs(user_id, action, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_monthly (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  ai_chat_count INTEGER DEFAULT 0,
  game_analysis_count INTEGER DEFAULT 0,
  report_gen_count INTEGER DEFAULT 0,
  opening_explore_count INTEGER DEFAULT 0,
  training_plan_count INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,
  UNIQUE(user_id, month)
);

-- ─────────────────────────────────────────
-- GAMES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('chess.com', 'lichess')),
  platform_game_id TEXT NOT NULL,
  pgn TEXT NOT NULL,
  fen_final TEXT,
  white_username TEXT,
  black_username TEXT,
  user_color TEXT CHECK (user_color IN ('white', 'black')),
  time_control TEXT,
  time_class TEXT CHECK (time_class IN ('bullet', 'blitz', 'rapid', 'classical', 'correspondence', 'unknown')),
  result TEXT CHECK (result IN ('1-0', '0-1', '1/2-1/2')),
  user_result TEXT CHECK (user_result IN ('win', 'loss', 'draw')),
  user_rating INTEGER,
  opponent_rating INTEGER,
  opening_eco TEXT,
  opening_name TEXT,
  termination TEXT,
  played_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  analysis_status TEXT DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'queued', 'analyzing', 'done', 'failed')),
  analysis_queued_at TIMESTAMPTZ,
  analysis_failed_reason TEXT,
  UNIQUE(platform, platform_game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_games_user_played ON games(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_analysis_status ON games(analysis_status) WHERE analysis_status IN ('pending', 'queued');
CREATE INDEX IF NOT EXISTS idx_games_user_platform ON games(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_games_opening ON games(user_id, opening_eco) WHERE opening_eco IS NOT NULL;

-- ─────────────────────────────────────────
-- GAME ANALYSES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL DEFAULT 14,
  accuracy_score NUMERIC(5, 2),
  blunder_count INTEGER DEFAULT 0,
  mistake_count INTEGER DEFAULT 0,
  inaccuracy_count INTEGER DEFAULT 0,
  good_count INTEGER DEFAULT 0,
  best_count INTEGER DEFAULT 0,
  opening_accuracy NUMERIC(5, 2),
  middlegame_accuracy NUMERIC(5, 2),
  endgame_accuracy NUMERIC(5, 2),
  avg_move_time_ms INTEGER,
  time_pressure_blunders INTEGER DEFAULT 0,
  move_evaluations JSONB DEFAULT '[]',
  critical_moments JSONB DEFAULT '[]',
  opening_comment TEXT,
  middlegame_comment TEXT,
  endgame_comment TEXT,
  key_lesson TEXT,
  coach_summary TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_id)
);

CREATE INDEX IF NOT EXISTS idx_game_analyses_user ON game_analyses(user_id, analyzed_at DESC);

-- ─────────────────────────────────────────
-- MOVE ANALYSES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS move_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  move_number INTEGER NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('white', 'black')),
  san TEXT NOT NULL,
  uci TEXT NOT NULL,
  fen_before TEXT NOT NULL,
  eval_before NUMERIC(8, 2),
  eval_after NUMERIC(8, 2),
  best_move_uci TEXT,
  best_move_san TEXT,
  best_move_eval NUMERIC(8, 2),
  eval_loss NUMERIC(8, 2),
  classification TEXT CHECK (classification IN ('brilliant', 'great', 'best', 'good', 'inaccuracy', 'mistake', 'blunder', 'miss')),
  time_spent_ms INTEGER,
  is_in_endgame BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_move_analyses_game ON move_analyses(game_id);
CREATE INDEX IF NOT EXISTS idx_move_analyses_user_class ON move_analyses(user_id, classification);
CREATE INDEX IF NOT EXISTS idx_move_analyses_user_recent ON move_analyses(user_id, created_at DESC);

-- ─────────────────────────────────────────
-- USER WEAKNESSES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_weaknesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('tactical', 'positional', 'opening', 'endgame', 'time_management', 'psychological')),
  subcategory TEXT NOT NULL,
  severity INTEGER DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  occurrence_count INTEGER DEFAULT 1,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  games_sample JSONB DEFAULT '[]',
  ai_explanation TEXT,
  improvement_tip TEXT,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, subcategory)
);

CREATE INDEX IF NOT EXISTS idx_weaknesses_user ON user_weaknesses(user_id, severity DESC);

-- ─────────────────────────────────────────
-- OPENING STATS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opening_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  eco TEXT NOT NULL,
  opening_name TEXT,
  color TEXT NOT NULL CHECK (color IN ('white', 'black')),
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  avg_accuracy NUMERIC(5, 2),
  avg_deviation_move INTEGER,
  ai_recommendation TEXT CHECK (ai_recommendation IN ('keep', 'improve', 'replace')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, eco, color)
);

-- ─────────────────────────────────────────
-- CHAT SESSIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New Conversation',
  context_game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

-- ─────────────────────────────────────────
-- CHAT MESSAGES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  model_used TEXT,
  retrieved_memory_ids JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);

-- ─────────────────────────────────────────
-- ANALYSIS REPORTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL CHECK (report_type IN ('weekly', 'monthly', 'opening', 'full_profile', 'game_batch')),
  title TEXT NOT NULL,
  summary TEXT,
  content JSONB NOT NULL DEFAULT '{}',
  games_analyzed INTEGER DEFAULT 0,
  date_range_start TIMESTAMPTZ,
  date_range_end TIMESTAMPTZ,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON analysis_reports(user_id, generated_at DESC);

-- ─────────────────────────────────────────
-- TRAINING PLANS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  duration_days INTEGER NOT NULL DEFAULT 7,
  focus_areas JSONB DEFAULT '[]',
  daily_tasks JSONB DEFAULT '[]',
  progress JSONB DEFAULT '{"completed_tasks": [], "completion_pct": 0}',
  is_active BOOLEAN DEFAULT TRUE,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_user ON training_plans(user_id, is_active);

-- ─────────────────────────────────────────
-- RATING HISTORY
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rating_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  time_class TEXT NOT NULL,
  rating INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rating_history_user ON rating_history(user_id, platform, time_class, recorded_at DESC);

-- ─────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_weaknesses_updated_at BEFORE UPDATE ON user_weaknesses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_training_updated_at BEFORE UPDATE ON training_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trigger_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
