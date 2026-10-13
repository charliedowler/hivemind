SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE knowledge_snapshots ADD COLUMN IF NOT EXISTS audience_team_ids text[] NOT NULL DEFAULT '{}';
UPDATE knowledge_snapshots SET audience_team_ids = ARRAY[team_id] WHERE cardinality(audience_team_ids) = 0;
CREATE TABLE IF NOT EXISTS owner_capture_policies (
  owner_member_id text PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  include_patterns text[] NOT NULL DEFAULT '{}',
  exclude_patterns text[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  human_instruction text NOT NULL DEFAULT '',
  updated_by text REFERENCES members(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(include_patterns) <= 100 AND cardinality(exclude_patterns) <= 100)
);
CREATE TABLE IF NOT EXISTS capture_policy_delegations (
  id text PRIMARY KEY,
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  agent_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  policy_revision integer NOT NULL CHECK (policy_revision >= 0),
  include_patterns text[] NOT NULL,
  exclude_patterns text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS owner_capture_policy_history (
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  include_patterns text[] NOT NULL,
  exclude_patterns text[] NOT NULL,
  human_instruction text NOT NULL,
  actor_member_id text NOT NULL REFERENCES members(id),
  authority text NOT NULL CHECK (authority IN ('human','initial_instruction','delegation','restriction')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_member_id, revision)
);
CREATE TABLE IF NOT EXISTS project_sharing_grants (
  id text PRIMARY KEY,
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_pattern text NOT NULL CHECK (length(repo_pattern) BETWEEN 1 AND 256),
  revision integer NOT NULL DEFAULT 1,
  granted_by text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_by text REFERENCES members(id),
  UNIQUE (owner_member_id, team_id, repo_pattern)
);
CREATE TABLE IF NOT EXISTS learning_shares (
  learning_id text NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  owner_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  public_content jsonb NOT NULL CHECK (jsonb_typeof(public_content) = 'object'),
  project_grant_id text REFERENCES project_sharing_grants(id),
  granted_by text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_by text REFERENCES members(id),
  admin_outdated boolean NOT NULL DEFAULT false,
  PRIMARY KEY (learning_id, team_id)
);
CREATE INDEX IF NOT EXISTS learning_shares_active_audience_idx ON learning_shares(team_id, learning_id) WHERE withdrawn_at IS NULL;
CREATE TABLE IF NOT EXISTS hive_sharing_legacy_constraints (
  table_name text NOT NULL,
  constraint_name text NOT NULL,
  definition text NOT NULL,
  PRIMARY KEY (table_name, constraint_name)
);
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype = 'f' AND confrelid = 'learnings'::regclass AND conrelid IN ('feedback'::regclass, 'feedback_receipts'::regclass) AND cardinality(confkey) = 2 LOOP
    INSERT INTO hive_sharing_legacy_constraints VALUES (c.table_name, c.conname, c.definition) ON CONFLICT DO NOTHING;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', c.table_name, c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_cell_identity_fk') THEN
    ALTER TABLE feedback ADD CONSTRAINT feedback_cell_identity_fk FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE;
    ALTER TABLE feedback_receipts ADD CONSTRAINT feedback_receipts_cell_identity_fk FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feedback_pkey' AND cardinality(conkey) = 2) THEN
    ALTER TABLE feedback DROP CONSTRAINT feedback_pkey;
    ALTER TABLE feedback ADD PRIMARY KEY (learning_id, team_id, member_id);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION hive_validate_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cell learnings; target teams; BEGIN
  IF TG_OP = 'UPDATE' AND NEW.learning_id = OLD.learning_id AND NEW.team_id = OLD.team_id AND NEW.owner_member_id = OLD.owner_member_id AND NEW.revision = OLD.revision AND NEW.public_content = OLD.public_content THEN RETURN NEW; END IF;
  SELECT * INTO cell FROM learnings WHERE id = NEW.learning_id FOR SHARE;
  SELECT * INTO target FROM teams WHERE id = NEW.team_id FOR SHARE;
  IF target.personal_owner_member_id IS NOT NULL OR cell.owner_member_id <> NEW.owner_member_id OR NOT EXISTS (SELECT 1 FROM teams WHERE id = cell.team_id AND personal_owner_member_id = NEW.owner_member_id) THEN
    RAISE EXCEPTION 'Only a personal original can be published to an organisation' USING ERRCODE = '23514';
  END IF;
  IF NEW.revision <> cell.revision OR NEW.public_content - ARRAY['id','member_id','owner_member_id','title','body','kind','tags','repo','paths','confidence','source','push_count','lifecycle','revision','verify_after','area','cost','blocked','workaround','created_at','updated_at','last_pushed_at','embedding','superseded_by'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Publish only approved fields from the current revision' USING ERRCODE = '23514';
  END IF;
  IF NEW.public_content ?| ARRAY['capture_context','capture_categories','capture_rule_ids','classification','session_ref'] THEN
    RAISE EXCEPTION 'Private capture context cannot be published' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_validate_publication BEFORE INSERT OR UPDATE ON learning_shares FOR EACH ROW EXECUTE FUNCTION hive_validate_publication();
CREATE OR REPLACE FUNCTION hive_dirty_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_team text; BEGIN
  PERFORM pg_advisory_xact_lock(7288, 3);
  target_team := CASE WHEN TG_OP = 'DELETE' THEN OLD.team_id ELSE NEW.team_id END;
  INSERT INTO knowledge_state (team_id, revision) VALUES (target_team, 1) ON CONFLICT (team_id) DO UPDATE SET revision = knowledge_state.revision + 1, updated_at = now();
  DELETE FROM knowledge_snapshots WHERE team_id = target_team OR team_id IN (SELECT id FROM teams WHERE personal_owner_member_id IS NOT NULL);
  DELETE FROM ask_log WHERE cited_ids && ARRAY[CASE WHEN TG_OP = 'DELETE' THEN OLD.learning_id ELSE NEW.learning_id END];
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER hive_dirty_publication AFTER INSERT OR UPDATE OR DELETE ON learning_shares FOR EACH ROW EXECUTE FUNCTION hive_dirty_publication();
CREATE OR REPLACE FUNCTION hive_same_owner_relation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM learnings a JOIN learnings b ON a.owner_member_id = b.owner_member_id AND a.team_id = b.team_id WHERE a.id = NEW.older_id AND b.id = NEW.newer_id AND a.team_id = NEW.team_id) THEN
    RAISE EXCEPTION 'Cells from different owners cannot replace or merge each other' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_same_owner_relation BEFORE INSERT OR UPDATE OF older_id, newer_id ON learning_supersessions FOR EACH ROW EXECUTE FUNCTION hive_same_owner_relation();
CREATE OR REPLACE VIEW learning_audience_cells AS
SELECT l.*, l.team_id AS storage_team_id, false AS is_share FROM learnings l
UNION ALL
SELECT p.*, l.team_id AS storage_team_id, true AS is_share
FROM learning_shares s JOIN learnings l ON l.id = s.learning_id
CROSS JOIN LATERAL jsonb_populate_record(NULL::learnings,
  s.public_content || jsonb_build_object(
    'id', s.learning_id, 'team_id', s.team_id, 'owner_member_id', s.owner_member_id,
    'revision', s.revision, 'capture_flagged', false, 'capture_redacted', false,
    'capture_context', '{}'::jsonb, 'capture_categories', '{}'::jsonb, 'capture_rule_ids', '[]'::jsonb,
    'admin_outdated', s.admin_outdated,
    'lifecycle', CASE WHEN s.admin_outdated OR (SELECT count(*) FILTER (WHERE vote = 'outdated') > count(*) FILTER (WHERE vote = 'up') FROM feedback f WHERE f.learning_id = s.learning_id AND f.team_id = s.team_id) THEN 'outdated' WHEN EXISTS (SELECT 1 FROM feedback f WHERE f.learning_id = s.learning_id AND f.team_id = s.team_id AND f.vote = 'up') THEN 'confirmed' ELSE s.public_content->>'lifecycle' END,
    'up_votes', (SELECT count(*) FROM feedback f WHERE f.learning_id = s.learning_id AND f.team_id = s.team_id AND f.vote = 'up'),
    'down_votes', (SELECT count(*) FROM feedback f WHERE f.learning_id = s.learning_id AND f.team_id = s.team_id AND f.vote = 'down'),
    'outdated_votes', (SELECT count(*) FROM feedback f WHERE f.learning_id = s.learning_id AND f.team_id = s.team_id AND f.vote = 'outdated'),
    'search', setweight(to_tsvector('english', s.public_content->>'title'), 'A') || setweight(hive_tag_search(ARRAY(SELECT jsonb_array_elements_text(s.public_content->'tags'))), 'B') || setweight(to_tsvector('english', s.public_content->>'body'), 'C')
  )) p
WHERE s.withdrawn_at IS NULL AND l.lifecycle <> 'retracted'
  AND EXISTS (SELECT 1 FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = s.owner_member_id AND h.team_id = s.team_id AND h.removed_at IS NULL AND m.disabled_at IS NULL)
  AND (s.project_grant_id IS NULL OR EXISTS (SELECT 1 FROM project_sharing_grants g WHERE g.id = s.project_grant_id AND g.withdrawn_at IS NULL));

CREATE OR REPLACE FUNCTION hive_withdraw_restricted_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle = 'retracted' OR NEW.capture_flagged OR NEW.capture_redacted IS DISTINCT FROM OLD.capture_redacted THEN
    UPDATE learning_shares SET withdrawn_at = now() WHERE learning_id = NEW.id AND withdrawn_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER hive_withdraw_restricted_original AFTER UPDATE ON learnings FOR EACH ROW EXECUTE FUNCTION hive_withdraw_restricted_original();
CREATE OR REPLACE FUNCTION hive_withdraw_membership_publications() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor_id text; audience_id text; BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL) THEN RETURN NULL; END IF;
  actor_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.member_id ELSE NEW.member_id END;
  audience_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.team_id ELSE NEW.team_id END;
  UPDATE learning_shares SET withdrawn_at = now() WHERE owner_member_id = actor_id AND team_id = audience_id AND withdrawn_at IS NULL;
  UPDATE project_sharing_grants SET withdrawn_at = now() WHERE owner_member_id = actor_id AND team_id = audience_id AND withdrawn_at IS NULL;
  PERFORM pg_advisory_xact_lock(7288, 3);
  DELETE FROM knowledge_snapshots WHERE team_id = audience_id OR audience_id = ANY(audience_team_ids);
  INSERT INTO knowledge_state (team_id, revision) SELECT audience_id, 1 WHERE EXISTS (SELECT 1 FROM teams WHERE id = audience_id) ON CONFLICT (team_id) DO UPDATE SET revision = knowledge_state.revision + 1, updated_at = now();
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER hive_withdraw_membership_publications AFTER UPDATE OF removed_at OR DELETE ON hive_memberships FOR EACH ROW EXECUTE FUNCTION hive_withdraw_membership_publications();
CREATE OR REPLACE FUNCTION hive_withdraw_disabled_owner_publications() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.disabled_at IS NULL AND NEW.disabled_at IS NOT NULL THEN
    UPDATE learning_shares SET withdrawn_at = now() WHERE owner_member_id = NEW.id AND withdrawn_at IS NULL;
    UPDATE project_sharing_grants SET withdrawn_at = now() WHERE owner_member_id = NEW.id AND withdrawn_at IS NULL;
    DELETE FROM knowledge_snapshots WHERE member_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE TRIGGER hive_withdraw_disabled_owner_publications AFTER UPDATE OF disabled_at ON members FOR EACH ROW EXECUTE FUNCTION hive_withdraw_disabled_owner_publications();
