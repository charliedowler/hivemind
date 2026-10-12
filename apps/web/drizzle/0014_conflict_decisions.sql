SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS conflict_decisions (
  id text PRIMARY KEY,
  team_id text NOT NULL,
  edge_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('supersede','keep_both','keep_old','mark_outdated','retract_new','undecided','reversed')),
  reason text NOT NULL,
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  model text NOT NULL,
  jev jsonb,
  latency_ms integer NOT NULL,
  pushed_by text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  reverses_id text,
  moved_push_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, team_id),
  FOREIGN KEY (edge_id, team_id) REFERENCES learning_supersessions(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (pushed_by, team_id) REFERENCES members(id, team_id),
  FOREIGN KEY (reverses_id, team_id) REFERENCES conflict_decisions(id, team_id),
  UNIQUE (reverses_id)
);
CREATE INDEX IF NOT EXISTS conflict_decisions_log_idx ON conflict_decisions(team_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS conflict_decisions_edge_idx ON conflict_decisions(team_id, edge_id, created_at DESC);
INSERT INTO conflict_decisions (id, team_id, edge_id, decision, reason, confidence, model, latency_ms, pushed_by, before_state, after_state, created_at)
SELECT 'dec_legacy_' || s.id, s.team_id, s.id,
  CASE s.status WHEN 'accepted' THEN 'supersede' WHEN 'rejected' THEN 'keep_both' ELSE 'undecided' END,
  CASE WHEN s.status = 'candidate' THEN 'Hive retries this earlier comparison automatically on a related push.' ELSE s.reason END,
  s.confidence, 'legacy', 0, b.member_id, '[]'::jsonb, '[]'::jsonb, coalesce(s.decided_at, s.created_at)
FROM learning_supersessions s JOIN learnings b ON b.id = s.newer_id AND b.team_id = s.team_id
ON CONFLICT (id) DO NOTHING;
