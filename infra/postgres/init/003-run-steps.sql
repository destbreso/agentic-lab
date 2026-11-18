-- ===========================================================
-- Run steps: what each role saw and did, one row per turn
-- ===========================================================
-- Each row is one role's turn: its inputs with their provenance
-- (given, measured or written), the exact messages sent to its
-- model and the replies, what it emitted, its tokens and time.
-- run_id is the session's run id (runs.external_id).
-- ===========================================================
CREATE TABLE IF NOT EXISTS run_steps (
  id BIGSERIAL PRIMARY KEY,
  run_id VARCHAR(100) NOT NULL,
  seq INTEGER NOT NULL,
  round INTEGER,
  role VARCHAR(100) NOT NULL,
  role_name VARCHAR(255) NOT NULL,
  category VARCHAR(30) NOT NULL,
  inputs JSONB NOT NULL DEFAULT '[]',
  calls JSONB NOT NULL DEFAULT '[]',
  outputs JSONB NOT NULL DEFAULT '[]',
  tool_calls JSONB NOT NULL DEFAULT '[]',
  tokens JSONB NOT NULL DEFAULT '{}',
  success BOOLEAN NOT NULL DEFAULT false,
  errors JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, seq);
