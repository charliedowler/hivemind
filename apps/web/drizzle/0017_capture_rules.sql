SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS capture_context jsonb NOT NULL DEFAULT '{}';
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS capture_categories jsonb NOT NULL DEFAULT '{}';
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS capture_flagged boolean NOT NULL DEFAULT false;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS capture_redacted boolean NOT NULL DEFAULT false;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS capture_rule_ids text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS learnings_capture_visibility_idx ON learnings(team_id, member_id) WHERE capture_flagged;
CREATE TABLE IF NOT EXISTS capture_rules (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  member_id text,
  created_by text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  scope text NOT NULL CHECK (scope IN ('team','member')),
  kind text NOT NULL CHECK (kind IN ('repo_owner','repo_match','path_match','content_category','agent_or_client','keyword')),
  action text NOT NULL CHECK (action IN ('drop','redact','flag')),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL,
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','slack','mcp')),
  natural_text text,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, team_id),
  CHECK ((scope = 'team' AND member_id IS NULL) OR (scope = 'member' AND member_id IS NOT NULL)),
  FOREIGN KEY (member_id, team_id) REFERENCES members(id, team_id),
  FOREIGN KEY (created_by, team_id) REFERENCES members(id, team_id)
);
ALTER TABLE capture_rules ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web' CHECK (source IN ('web','slack','mcp'));
ALTER TABLE capture_rules ADD COLUMN IF NOT EXISTS natural_text text;
CREATE INDEX IF NOT EXISTS capture_rules_effective_idx ON capture_rules(team_id, member_id, created_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS capture_rule_previews (
  token_hash text PRIMARY KEY,
  rule_id text NOT NULL,
  team_id text NOT NULL,
  member_id text NOT NULL,
  rule_revision integer NOT NULL,
  cells jsonb NOT NULL,
  scanned integer NOT NULL,
  truncated boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (rule_id, team_id) REFERENCES capture_rules(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, team_id) REFERENCES members(id, team_id)
);
ALTER TABLE capture_rule_previews ADD COLUMN IF NOT EXISTS next_cursor text;
CREATE TABLE IF NOT EXISTS capture_rule_applications (
  id text PRIMARY KEY,
  team_id text NOT NULL,
  rule_id text NOT NULL,
  learning_id text NOT NULL,
  member_id text NOT NULL,
  previous_state text NOT NULL,
  action text NOT NULL DEFAULT 'drop' CHECK (action IN ('drop','redact','flag')),
  rule_name text NOT NULL DEFAULT 'Capture rule',
  before_snapshot jsonb NOT NULL DEFAULT '{}',
  applied_revision integer NOT NULL,
  reason_code text NOT NULL DEFAULT 'capture_rule' CHECK (reason_code = 'capture_rule'),
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  FOREIGN KEY (learning_id, team_id) REFERENCES learnings(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, team_id) REFERENCES members(id, team_id),
  FOREIGN KEY (reversed_by, team_id) REFERENCES members(id, team_id)
);
ALTER TABLE capture_rule_applications ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'drop' CHECK (action IN ('drop','redact','flag'));
ALTER TABLE capture_rule_applications ADD COLUMN IF NOT EXISTS rule_name text NOT NULL DEFAULT 'Capture rule';
ALTER TABLE capture_rule_applications ADD COLUMN IF NOT EXISTS before_snapshot jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS capture_rule_applications_team_idx ON capture_rule_applications(team_id, created_at DESC);
UPDATE knowledge_state SET revision = revision + 1, updated_at = now();
