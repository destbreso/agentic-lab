-- ===========================================================
-- Chat Sessions & Messages — Persistent conversations
-- ===========================================================
-- Adds ChatGPT-like persistent sessions and message history.
-- Sessions survive page navigations and browser restarts.
-- ===========================================================
-- Chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL DEFAULT 'New session',
  model VARCHAR(100) NOT NULL DEFAULT 'llama3.1:8b',
  provider VARCHAR(50) NOT NULL DEFAULT 'ollama',
  mode VARCHAR(10) NOT NULL DEFAULT 'chat' CHECK (mode IN ('chat', 'agent')),
  recipe VARCHAR(100),
  message_count INTEGER NOT NULL DEFAULT 0,
  token_count BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'error')),
  run_id VARCHAR(100),
  -- link to agent run external_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_run_id ON chat_sessions(run_id);
-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'agent')),
  content TEXT NOT NULL,
  tokens INTEGER,
  duration_ms BIGINT,
  model VARCHAR(100),
  message_type VARCHAR(20) DEFAULT 'text',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
-- Auto-update updated_at on session changes
CREATE TRIGGER trigger_chat_sessions_updated_at BEFORE
UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();