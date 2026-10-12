SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'fresh' CHECK (lifecycle IN ('fresh', 'confirmed', 'superseded', 'outdated', 'retracted'));
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS verify_after timestamptz;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE learnings ADD COLUMN IF NOT EXISTS superseded_by text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learnings_successor_team_fk') THEN
    ALTER TABLE learnings ADD CONSTRAINT learnings_successor_team_fk FOREIGN KEY (superseded_by, team_id) REFERENCES learnings(id, team_id);
  END IF;
END $$;
UPDATE learnings SET lifecycle = CASE WHEN admin_outdated OR outdated_votes > up_votes THEN 'outdated' WHEN up_votes > 0 OR push_count > 1 THEN 'confirmed' ELSE 'fresh' END WHERE revision = 1 AND lifecycle = 'fresh';
UPDATE learnings SET verify_after = created_at + (CASE WHEN area = 'environment' THEN 14 WHEN kind IN ('snippet', 'incident') OR tags && ARRAY['version','versions','dependency','dependencies','url','urls'] THEN 30 WHEN kind IN ('gotcha','friction') THEN 45 WHEN kind = 'decision' THEN 180 ELSE 90 END) * interval '1 day' WHERE verify_after IS NULL;
CREATE INDEX IF NOT EXISTS learnings_team_lifecycle_idx ON learnings(team_id, lifecycle, last_pushed_at DESC);
CREATE TABLE IF NOT EXISTS learning_versions (
  learning_id text NOT NULL,
  team_id text NOT NULL,
  revision integer NOT NULL,
  member_id text NOT NULL,
  content jsonb NOT NULL,
  diff jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learning_id, team_id, revision),
  FOREIGN KEY (learning_id, team_id) REFERENCES learnings(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, team_id) REFERENCES members(id, team_id)
);
CREATE TABLE IF NOT EXISTS learning_supersessions (
  id text PRIMARY KEY,
  team_id text NOT NULL,
  older_id text NOT NULL,
  newer_id text NOT NULL,
  older_revision integer NOT NULL,
  newer_revision integer NOT NULL,
  relation text NOT NULL CHECK (relation IN ('update','contradiction')),
  confidence real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','accepted','rejected')),
  reason text NOT NULL,
  decided_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (older_id <> newer_id),
  UNIQUE (id, team_id),
  UNIQUE (team_id, older_id, newer_id),
  FOREIGN KEY (older_id, team_id) REFERENCES learnings(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (newer_id, team_id) REFERENCES learnings(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by, team_id) REFERENCES members(id, team_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS learning_one_successor_idx ON learning_supersessions(team_id, older_id) WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS learning_conflicts_idx ON learning_supersessions(team_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS learning_predecessors_idx ON learning_supersessions(team_id, newer_id) WHERE status = 'accepted';
CREATE TABLE IF NOT EXISTS learning_conflict_votes (
  edge_id text NOT NULL,
  team_id text NOT NULL,
  member_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (edge_id, team_id, member_id),
  FOREIGN KEY (edge_id, team_id) REFERENCES learning_supersessions(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (member_id, team_id) REFERENCES members(id, team_id)
);
CREATE OR REPLACE FUNCTION hive_learning_content(cell learnings) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT to_jsonb(cell) - ARRAY['embedding','search','revision','classification','push_count','up_votes','down_votes','outdated_votes','created_at','updated_at','last_pushed_at'];
$$;
INSERT INTO learning_versions (learning_id, team_id, revision, member_id, content, diff, created_at)
  SELECT id, team_id, revision, member_id, hive_learning_content(learnings), '{}'::jsonb, updated_at FROM learnings
  ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION hive_prepare_learning_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF hive_learning_content(NEW) IS DISTINCT FROM hive_learning_content(OLD) THEN
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := now();
  ELSE
    NEW.revision := OLD.revision;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION hive_record_learning_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb := '{}'::jsonb; current jsonb; changes jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.revision = OLD.revision THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN previous := hive_learning_content(OLD); END IF;
  current := hive_learning_content(NEW);
  SELECT coalesce(jsonb_object_agg(key, jsonb_build_object('before', previous -> key, 'after', value)), '{}'::jsonb)
    INTO changes FROM jsonb_each(current) WHERE previous -> key IS DISTINCT FROM value;
  INSERT INTO learning_versions (learning_id, team_id, revision, member_id, content, diff)
    VALUES (NEW.id, NEW.team_id, NEW.revision, coalesce(nullif(current_setting('hive.actor', true), ''), NEW.member_id), current, changes);
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_prepare_learning_version BEFORE UPDATE ON learnings FOR EACH ROW EXECUTE FUNCTION hive_prepare_learning_version();
CREATE OR REPLACE TRIGGER hive_record_learning_version AFTER INSERT OR UPDATE ON learnings FOR EACH ROW EXECUTE FUNCTION hive_record_learning_version();
