SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS hive_cutover_rollback_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  state jsonb NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM hive_cutover_rollback_state) THEN
    INSERT INTO hive_cutover_rollback_state (state)
    SELECT jsonb_build_object(
      'members', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'team_id', team_id, 'role', role, 'removed_at', removed_at) ORDER BY id), '[]') FROM members),
      'memberships', (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY member_id, team_id), '[]') FROM hive_memberships h),
      'identity_constraints', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY table_name, constraint_name), '[]') FROM hive_identity_legacy_constraints c),
      'member_constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', conname, 'definition', pg_get_constraintdef(oid)) ORDER BY conname), '[]') FROM pg_constraint WHERE conrelid = 'members'::regclass AND conkey && ARRAY(SELECT attnum FROM pg_attribute WHERE attrelid = 'members'::regclass AND attname IN ('team_id','role','removed_at')))
    );
  END IF;
END $$;

INSERT INTO auth_verification (id, identifier, value, expires_at, created_at)
VALUES ('hive-oauth-cutover', 'hive-oauth-cutover', '0', '9999-01-01'::timestamptz, clock_timestamp())
ON CONFLICT (id) DO NOTHING;
UPDATE auth_oauth_client SET scopes = array_append(scopes, 'hive:person') WHERE 'hive' = ANY(scopes) AND NOT ('hive:person' = ANY(scopes));
UPDATE auth_oauth_resource SET allowed_scopes = array_append(allowed_scopes, 'hive:person') WHERE 'hive' = ANY(allowed_scopes) AND NOT ('hive:person' = ANY(allowed_scopes));

DROP TRIGGER IF EXISTS hive_selected_membership ON members;
DROP FUNCTION IF EXISTS hive_bridge_selected_membership();
CREATE OR REPLACE FUNCTION hive_dirty_member_knowledge() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE audiences text[]; BEGIN
  IF NEW.name IS NOT DISTINCT FROM OLD.name THEN RETURN NEW; END IF;
  SELECT array_agg(DISTINCT team_id) INTO audiences FROM (
    SELECT team_id FROM hive_memberships WHERE member_id = NEW.id
    UNION SELECT team_id FROM learning_shares WHERE owner_member_id = NEW.id AND withdrawn_at IS NULL
  ) affected;
  INSERT INTO knowledge_state (team_id, revision) SELECT unnest(audiences), 1
    ON CONFLICT (team_id) DO UPDATE SET revision = knowledge_state.revision + 1, updated_at = now();
  DELETE FROM knowledge_snapshots WHERE audience_team_ids && audiences;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_dirty_member_knowledge AFTER UPDATE OF name ON members FOR EACH ROW EXECUTE FUNCTION hive_dirty_member_knowledge();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND confrelid = 'members'::regclass AND cardinality(confkey) > 1) THEN
    RAISE EXCEPTION 'Selected member columns still have dependent foreign keys';
  END IF;
END $$;
ALTER TABLE members DROP COLUMN IF EXISTS team_id, DROP COLUMN IF EXISTS role, DROP COLUMN IF EXISTS removed_at;
DROP TABLE IF EXISTS hive_identity_legacy_constraints;
