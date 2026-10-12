SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE UNIQUE INDEX IF NOT EXISTS learning_pushes_id_team_idx ON learning_pushes(id, team_id);
CREATE TABLE IF NOT EXISTS learning_evidence (
  push_id text PRIMARY KEY,
  team_id text NOT NULL,
  learning_id text NOT NULL,
  payload jsonb,
  object_key text NOT NULL,
  digest text NOT NULL,
  bytes integer NOT NULL,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (push_id, team_id) REFERENCES learning_pushes(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (learning_id, team_id) REFERENCES learnings(id, team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS learning_evidence_pending_idx ON learning_evidence(team_id, created_at) WHERE uploaded_at IS NULL;
CREATE TABLE IF NOT EXISTS knowledge_state (
  team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  published_revision bigint NOT NULL DEFAULT -1,
  manifest jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  next_verify_at timestamptz
);
ALTER TABLE knowledge_state ADD COLUMN IF NOT EXISTS next_verify_at timestamptz;
INSERT INTO knowledge_state (team_id, revision) SELECT id, 1 FROM teams ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS knowledge_snapshots (
  token_hash text PRIMARY KEY,
  team_id text NOT NULL,
  member_id text NOT NULL,
  revision bigint NOT NULL,
  object_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, team_id) REFERENCES members(id, team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS knowledge_snapshots_expiry_idx ON knowledge_snapshots(expires_at);
CREATE OR REPLACE FUNCTION hive_dirty_knowledge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_team text;
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['embedding','search','classification']) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['embedding','search','classification']) THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN target_team := OLD.team_id; ELSE target_team := NEW.team_id; END IF;
  INSERT INTO knowledge_state (team_id, revision) VALUES (target_team, 1)
    ON CONFLICT (team_id) DO UPDATE SET revision = knowledge_state.revision + 1, updated_at = now();
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER hive_dirty_knowledge AFTER INSERT OR UPDATE OR DELETE ON learnings FOR EACH ROW EXECUTE FUNCTION hive_dirty_knowledge();
CREATE OR REPLACE TRIGGER hive_dirty_member_knowledge AFTER UPDATE OF name ON members FOR EACH ROW EXECUTE FUNCTION hive_dirty_knowledge();
