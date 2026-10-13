SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF to_regclass('capture_rule_proposals') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM capture_rule_proposals) THEN
      RAISE EXCEPTION 'Preserve pending capture rule proposals before replacing them';
    END IF;
    DROP TABLE capture_rule_proposals;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS capture_rule_instructions (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id),
  member_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('web', 'slack', 'mcp')),
  channel_id text,
  thread_ts text,
  decision jsonb NOT NULL CHECK (jsonb_typeof(decision) = 'object'),
  outcome text NOT NULL CHECK (outcome IN ('saved', 'question')),
  rule_id text,
  rule_revision integer,
  rule_snapshot jsonb,
  restatement text NOT NULL,
  natural_text text NOT NULL,
  question text,
  job_status text NOT NULL DEFAULT 'complete' CHECK (job_status IN ('pending', 'complete', 'stopped', 'undo_pending', 'undone')),
  job_cursor text,
  undo_cursor text,
  counts jsonb NOT NULL DEFAULT '{"scanned":0,"matched":0,"applied":0,"skipped":0,"restored":0,"retained":0}',
  undo_until timestamptz,
  undo_started_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (member_id, team_id) REFERENCES members(id, team_id),
  CHECK ((source = 'slack' AND channel_id IS NOT NULL AND length(channel_id) > 0 AND thread_ts IS NOT NULL AND thread_ts ~ '^[0-9]+\.[0-9]+$') OR (source <> 'slack' AND channel_id IS NULL AND thread_ts IS NULL)),
  CHECK ((outcome = 'saved' AND rule_id IS NOT NULL AND rule_revision IS NOT NULL AND rule_snapshot IS NOT NULL AND undo_until IS NOT NULL) OR (outcome = 'question' AND rule_id IS NULL AND rule_revision IS NULL AND rule_snapshot IS NULL AND undo_until IS NULL))
);
CREATE INDEX IF NOT EXISTS capture_rule_instructions_undo_idx ON capture_rule_instructions(team_id, member_id, source, created_at DESC, id DESC) WHERE outcome = 'saved';
CREATE INDEX IF NOT EXISTS capture_rule_instructions_jobs_idx ON capture_rule_instructions(updated_at, id) WHERE job_status IN ('pending', 'undo_pending');
ALTER TABLE capture_rule_applications ADD COLUMN IF NOT EXISTS instruction_id text REFERENCES capture_rule_instructions(id);
CREATE INDEX IF NOT EXISTS capture_rule_applications_instruction_idx ON capture_rule_applications(instruction_id, id) WHERE instruction_id IS NOT NULL;
DELETE FROM _migrations WHERE name ~ '^[0-9]+_capture_rule_proposals\.sql$';
