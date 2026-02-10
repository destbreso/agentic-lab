-- ===========================================================
-- Agentic Lab — PostgreSQL Schema Initialization
-- ===========================================================
-- This runs automatically when the postgres container starts
-- for the first time (via docker-entrypoint-initdb.d/).
-- ===========================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================================
-- RUNS — Top-level execution of an agentic loop
-- ===========================================================
CREATE TABLE IF NOT EXISTS runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id     VARCHAR(24) NOT NULL UNIQUE,    -- nanoid from the engine
    name            VARCHAR(255),
    status          VARCHAR(20) NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle','running','paused','completed','failed','stopped')),
    provider        VARCHAR(50) NOT NULL,
    model           VARCHAR(100) NOT NULL,
    max_iterations  INTEGER NOT NULL DEFAULT 10,
    working_dir     TEXT NOT NULL,
    
    -- Aggregate token usage
    total_input_tokens    BIGINT NOT NULL DEFAULT 0,
    total_output_tokens   BIGINT NOT NULL DEFAULT 0,
    total_tokens          BIGINT NOT NULL DEFAULT 0,
    
    -- Timing
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    duration_ms     BIGINT,
    
    -- Config snapshot (JSON)
    config          JSONB NOT NULL DEFAULT '{}',
    
    -- Result summary
    success         BOOLEAN,
    summary         TEXT,
    
    -- Meta
    tags            TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_provider ON runs(provider);
CREATE INDEX idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX idx_runs_tags ON runs USING GIN(tags);

-- ===========================================================
-- ITERATIONS — Individual iteration within a run
-- ===========================================================
CREATE TABLE IF NOT EXISTS iterations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id          UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    number          INTEGER NOT NULL,
    
    -- Status
    success         BOOLEAN NOT NULL DEFAULT false,
    
    -- Token usage
    input_tokens    BIGINT NOT NULL DEFAULT 0,
    output_tokens   BIGINT NOT NULL DEFAULT 0,
    total_tokens    BIGINT NOT NULL DEFAULT 0,
    
    -- Content
    response_text   TEXT,
    plan_item_id    VARCHAR(100),
    plan_item_title VARCHAR(500),
    
    -- Timing
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    duration_ms     BIGINT,
    
    -- Errors
    errors          JSONB DEFAULT '[]',
    
    -- Git
    commit_sha      VARCHAR(40),
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(run_id, number)
);

CREATE INDEX idx_iterations_run_id ON iterations(run_id);

-- ===========================================================
-- TOOL_CALLS — Individual tool invocations
-- ===========================================================
CREATE TABLE IF NOT EXISTS tool_calls (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    iteration_id    UUID NOT NULL REFERENCES iterations(id) ON DELETE CASCADE,
    run_id          UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    
    name            VARCHAR(100) NOT NULL,
    arguments       JSONB NOT NULL DEFAULT '{}',
    result          TEXT,
    is_error        BOOLEAN NOT NULL DEFAULT false,
    duration_ms     BIGINT,
    
    called_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_iteration_id ON tool_calls(iteration_id);
CREATE INDEX idx_tool_calls_run_id ON tool_calls(run_id);
CREATE INDEX idx_tool_calls_name ON tool_calls(name);

-- ===========================================================
-- CHECKPOINTS — State snapshots for time-travel / resume
-- ===========================================================
CREATE TABLE IF NOT EXISTS checkpoints (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id          UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    iteration       INTEGER NOT NULL,
    
    -- Full serialized state
    state           JSONB NOT NULL,
    
    -- Messages history at this point
    messages        JSONB NOT NULL DEFAULT '[]',
    
    -- Plan state at this checkpoint
    plan            JSONB NOT NULL DEFAULT '[]',
    
    -- Metadata
    metadata        JSONB DEFAULT '{}',
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(run_id, iteration)
);

CREATE INDEX idx_checkpoints_run_id ON checkpoints(run_id);

-- ===========================================================
-- MEMORIES — Cross-run semantic memory store
-- ===========================================================
CREATE TABLE IF NOT EXISTS memories (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    namespace       TEXT[] NOT NULL,        -- e.g. ['project-x', 'context']
    key             VARCHAR(255) NOT NULL,
    
    -- The actual memory content
    value           JSONB NOT NULL,
    
    -- Embedding vector stored in Qdrant, reference here
    qdrant_point_id VARCHAR(36),
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(namespace, key)
);

CREATE INDEX idx_memories_namespace ON memories USING GIN(namespace);

-- ===========================================================
-- PROVIDER_USAGE — Aggregated usage metrics per provider/model
-- ===========================================================
CREATE TABLE IF NOT EXISTS provider_usage (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id          UUID REFERENCES runs(id) ON DELETE SET NULL,
    provider        VARCHAR(50) NOT NULL,
    model           VARCHAR(100) NOT NULL,
    
    input_tokens    BIGINT NOT NULL DEFAULT 0,
    output_tokens   BIGINT NOT NULL DEFAULT 0,
    total_tokens    BIGINT NOT NULL DEFAULT 0,
    
    -- Estimated cost (USD)
    estimated_cost  DECIMAL(10, 6) DEFAULT 0,
    
    -- Latency
    latency_ms      BIGINT,
    
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_provider_usage_provider ON provider_usage(provider);
CREATE INDEX idx_provider_usage_recorded_at ON provider_usage(recorded_at DESC);

-- ===========================================================
-- EVENTS — Timeline of all events (for pub/sub replay)
-- ===========================================================
CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL PRIMARY KEY,
    run_id          UUID REFERENCES runs(id) ON DELETE CASCADE,
    event_type      VARCHAR(50) NOT NULL,   -- e.g. 'loop:start', 'tool:call'
    payload         JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_run_id ON events(run_id);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_created_at ON events(created_at DESC);

-- ===========================================================
-- Updated_at trigger function
-- ===========================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_runs_updated_at
    BEFORE UPDATE ON runs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_memories_updated_at
    BEFORE UPDATE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ===========================================================
-- Views for common queries
-- ===========================================================

-- Run summary with iteration counts
CREATE OR REPLACE VIEW v_run_summary AS
SELECT
    r.id,
    r.external_id,
    r.name,
    r.status,
    r.provider,
    r.model,
    r.total_tokens,
    r.duration_ms,
    r.success,
    r.started_at,
    r.ended_at,
    r.tags,
    COUNT(DISTINCT i.id) AS iteration_count,
    COUNT(DISTINCT tc.id) AS tool_call_count,
    COALESCE(SUM(pu.estimated_cost), 0) AS total_cost
FROM runs r
LEFT JOIN iterations i ON i.run_id = r.id
LEFT JOIN tool_calls tc ON tc.run_id = r.id
LEFT JOIN provider_usage pu ON pu.run_id = r.id
GROUP BY r.id;

-- Tool usage analytics
CREATE OR REPLACE VIEW v_tool_analytics AS
SELECT
    name,
    COUNT(*) AS call_count,
    AVG(duration_ms) AS avg_duration_ms,
    SUM(CASE WHEN is_error THEN 1 ELSE 0 END) AS error_count,
    MIN(called_at) AS first_used,
    MAX(called_at) AS last_used
FROM tool_calls
GROUP BY name
ORDER BY call_count DESC;

-- Daily usage stats
CREATE OR REPLACE VIEW v_daily_stats AS
SELECT
    DATE(started_at) AS day,
    COUNT(*) AS runs,
    SUM(total_tokens) AS tokens,
    AVG(duration_ms) AS avg_duration_ms,
    SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful_runs
FROM runs
WHERE started_at IS NOT NULL
GROUP BY DATE(started_at)
ORDER BY day DESC;
