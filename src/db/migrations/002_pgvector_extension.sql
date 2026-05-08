-- Enable pgvector extension (must be enabled in Supabase dashboard first)
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────
-- USER MEMORIES (with vector embeddings)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('weakness', 'preference', 'progress', 'coaching_note', 'fact', 'goal')),
  content TEXT NOT NULL,
  embedding vector(1536),
  importance_score NUMERIC(3, 2) DEFAULT 0.50 CHECK (importance_score BETWEEN 0 AND 1),
  source TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  access_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id, is_active);

-- IVFFlat index for approximate nearest neighbor search
-- lists = sqrt(total rows expected), adjust as data grows
CREATE INDEX IF NOT EXISTS idx_user_memories_embedding
ON user_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────────────────────
-- CHESS KNOWLEDGE BASE (for RAG)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chess_knowledge (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chess_knowledge_embedding
ON chess_knowledge USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Function for memory similarity search
CREATE OR REPLACE FUNCTION search_user_memories(
  p_user_id UUID,
  p_query_embedding vector(1536),
  p_limit INTEGER DEFAULT 8,
  p_threshold FLOAT DEFAULT 0.70
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  memory_type TEXT,
  importance_score NUMERIC,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    um.id,
    um.content,
    um.memory_type,
    um.importance_score,
    1 - (um.embedding <=> p_query_embedding) AS similarity
  FROM user_memories um
  WHERE um.user_id = p_user_id
    AND um.is_active = TRUE
    AND um.embedding IS NOT NULL
    AND 1 - (um.embedding <=> p_query_embedding) > p_threshold
  ORDER BY similarity DESC, um.importance_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
