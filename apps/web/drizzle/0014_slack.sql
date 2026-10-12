SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learnings DROP CONSTRAINT IF EXISTS learnings_source_check;
ALTER TABLE learnings ADD CONSTRAINT learnings_source_check CHECK(source IN ('claude-code','codex','manual','slack'));
CREATE TABLE IF NOT EXISTS slack_installations (
 team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
 workspace_id text NOT NULL UNIQUE,
 workspace_name text NOT NULL,
 bot_user_id text NOT NULL,
 token_ciphertext text NOT NULL,
 installed_by text NOT NULL REFERENCES members(id),
 scopes text[] NOT NULL,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS slack_oauth_states (
 token_hash text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 member_id text NOT NULL REFERENCES members(id),
 browser_hash text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS slack_channels (
 team_id text NOT NULL REFERENCES slack_installations(team_id) ON DELETE CASCADE,
 channel_id text NOT NULL,
 name text NOT NULL,
 private boolean NOT NULL,
 state text NOT NULL DEFAULT 'purged' CHECK (state IN ('enabled','paused','purged')),
 generation integer NOT NULL DEFAULT 0,
 bot_member boolean NOT NULL DEFAULT true,
 backfill_cursor text,
 backfill_threads jsonb NOT NULL DEFAULT '[]',
 backfill_done boolean NOT NULL DEFAULT false,
 backfill_history_done boolean NOT NULL DEFAULT false,
 last_error text,
 PRIMARY KEY(team_id,channel_id)
);
CREATE TABLE IF NOT EXISTS slack_messages (
 id text PRIMARY KEY,
 team_id text NOT NULL,
 channel_id text NOT NULL,
 ts text NOT NULL,
 thread_ts text NOT NULL,
 author_id text NOT NULL,
 author_name text NOT NULL,
 text text NOT NULL,
 permalink text NOT NULL,
 posted_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 search tsvector GENERATED ALWAYS AS (to_tsvector('english',text)) STORED,
 UNIQUE(team_id,channel_id,ts),
 FOREIGN KEY(team_id,channel_id) REFERENCES slack_channels(team_id,channel_id) ON DELETE CASCADE
);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_type WHERE typname='vector') THEN
  ALTER TABLE slack_messages ADD COLUMN IF NOT EXISTS embedding vector(1536);
  CREATE INDEX IF NOT EXISTS slack_messages_embedding ON slack_messages USING hnsw(embedding vector_cosine_ops);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS slack_messages_search ON slack_messages USING gin(search);
CREATE INDEX IF NOT EXISTS slack_messages_team_channel_time ON slack_messages(team_id,channel_id,posted_at DESC);
CREATE TABLE IF NOT EXISTS slack_actor_links (
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 slack_user_id text NOT NULL,
 member_id text NOT NULL,
 PRIMARY KEY(team_id,slack_user_id),
 FOREIGN KEY(team_id,member_id) REFERENCES members(team_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS slack_jobs (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 dedupe_key text NOT NULL,
 channel_id text,
 generation integer,
 kind text NOT NULL,
 payload jsonb,
 status text NOT NULL DEFAULT 'pending',
 lease_until timestamptz,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(team_id,dedupe_key)
);
CREATE TABLE IF NOT EXISTS slack_ask_history (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 channel_id text NOT NULL,
 thread_ts text NOT NULL,
 actor_id text NOT NULL,
 question text NOT NULL,
 answer text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slack_ask_thread ON slack_ask_history(team_id,channel_id,thread_ts,created_at);
CREATE TABLE IF NOT EXISTS slack_decisions (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 channel_id text NOT NULL,
 thread_ts text NOT NULL,
 message_ts text NOT NULL,
 decision text NOT NULL,
 reason text NOT NULL,
 signals jsonb,
 evidence_ids text[] NOT NULL DEFAULT '{}',
 model text,
 latency_ms integer NOT NULL DEFAULT 0,
 prompted boolean NOT NULL,
 delivery text NOT NULL DEFAULT 'none',
 posted_ts text,
 policy_version text NOT NULL DEFAULT 'hive-slack-1',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slack_decision_channel ON slack_decisions(team_id,channel_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS slack_unprompted_thread ON slack_decisions(team_id,channel_id,thread_ts) WHERE prompted=false AND decision='reply_now';
