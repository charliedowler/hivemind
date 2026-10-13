SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS feedback_receipts (
  id text PRIMARY KEY,
  team_id text NOT NULL,
  learning_id text NOT NULL,
  member_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('report', 'withdraw')),
  outcome text,
  evidence jsonb,
  classification text CHECK (classification IN ('useful', 'contradicted', 'stale', 'inconclusive')),
  judgment jsonb,
  vote text CHECK (vote IN ('up', 'down', 'outdated')),
  target_receipt_id text,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  capture_flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, team_id, learning_id, member_id),
  FOREIGN KEY (learning_id, team_id) REFERENCES learnings(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, team_id) REFERENCES members(id, team_id)
);
CREATE INDEX IF NOT EXISTS feedback_receipts_cell_idx ON feedback_receipts(team_id, learning_id, created_at DESC);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS receipt_id text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_receipt_actor_fk') THEN
    ALTER TABLE feedback ADD CONSTRAINT feedback_receipt_actor_fk FOREIGN KEY (receipt_id, team_id, learning_id, member_id) REFERENCES feedback_receipts(id, team_id, learning_id, member_id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
