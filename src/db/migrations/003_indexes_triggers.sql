-- Auto-increment chat session message count
CREATE OR REPLACE FUNCTION increment_session_message_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_sessions
  SET message_count = message_count + 1, updated_at = NOW()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_chat_message_count
AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION increment_session_message_count();

-- Auto-create subscription on user creation
CREATE OR REPLACE FUNCTION create_default_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO subscriptions (user_id, plan, status, trial_start, trial_end)
  VALUES (
    NEW.id,
    'free',
    'trialing',
    NOW(),
    NOW() + INTERVAL '10 days'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_subscription
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_default_subscription();

-- Update opening stats on game analysis completion
CREATE OR REPLACE FUNCTION update_memory_access()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE user_memories
  SET access_count = access_count + 1, last_accessed_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Partial index for pending analysis jobs
CREATE INDEX IF NOT EXISTS idx_games_pending_analysis
ON games(user_id, fetched_at)
WHERE analysis_status = 'pending';

-- Index for monthly usage lookups
CREATE INDEX IF NOT EXISTS idx_usage_monthly_lookup
ON usage_monthly(user_id, month);

-- Composite index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_games_user_result_recent
ON games(user_id, user_result, played_at DESC)
WHERE played_at > NOW() - INTERVAL '90 days';
