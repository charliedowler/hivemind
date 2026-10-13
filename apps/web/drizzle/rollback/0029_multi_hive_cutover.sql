SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ DECLARE saved jsonb; BEGIN
  SELECT state INTO saved FROM hive_cutover_rollback_state WHERE id;
  IF saved IS NULL
    OR (SELECT coalesce(jsonb_agg(id ORDER BY id), '[]') FROM members) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x->'id' ORDER BY x->>'id'), '[]') FROM jsonb_array_elements(saved->'members') x)
    OR (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY member_id, team_id), '[]') FROM hive_memberships h) IS DISTINCT FROM saved->'memberships'
    OR EXISTS (SELECT 1 FROM auth_verification WHERE id = 'hive-oauth-cutover' AND value <> '0')
    OR EXISTS (SELECT 1 FROM auth_oauth_consent WHERE 'hive:person' = ANY(scopes) AND created_at > (SELECT created_at FROM auth_verification WHERE id = 'hive-oauth-cutover'))
    OR EXISTS (SELECT 1 FROM auth_oauth_refresh_token WHERE 'hive:person' = ANY(scopes) AND revoked IS NULL AND created_at > (SELECT created_at FROM auth_verification WHERE id = 'hive-oauth-cutover'))
    OR EXISTS (SELECT 1 FROM auth_oauth_access_token WHERE 'hive:person' = ANY(scopes) AND revoked IS NULL AND created_at > (SELECT created_at FROM auth_verification WHERE id = 'hive-oauth-cutover'))
  THEN RAISE EXCEPTION 'Refuse lossy cutover rollback: identities, memberships or person-wide grants changed'; END IF;
END $$;
ALTER TABLE members ADD COLUMN IF NOT EXISTS team_id text, ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member', ADD COLUMN IF NOT EXISTS removed_at timestamptz;
UPDATE members m SET team_id = x.team_id, role = x.role, removed_at = x.removed_at
FROM jsonb_to_recordset((SELECT state->'members' FROM hive_cutover_rollback_state WHERE id)) AS x(id text, team_id text, role text, removed_at timestamptz) WHERE m.id = x.id;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM jsonb_to_recordset((SELECT state->'member_constraints' FROM hive_cutover_rollback_state WHERE id)) AS x(name text, definition text) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'members'::regclass AND conname = item.name) THEN
      EXECUTE format('ALTER TABLE members ADD CONSTRAINT %I %s', item.name, item.definition);
    END IF;
  END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS hive_identity_legacy_constraints (table_name text NOT NULL, constraint_name text NOT NULL, definition text NOT NULL, PRIMARY KEY (table_name, constraint_name));
INSERT INTO hive_identity_legacy_constraints
SELECT * FROM jsonb_to_recordset((SELECT state->'identity_constraints' FROM hive_cutover_rollback_state WHERE id)) AS x(table_name text, constraint_name text, definition text) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION hive_bridge_selected_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.team_id IS NOT NULL THEN
    INSERT INTO hive_memberships (member_id, team_id, role, joined_at, removed_at)
      VALUES (NEW.id, NEW.team_id, NEW.role, NEW.created_at, NEW.removed_at)
      ON CONFLICT (member_id, team_id) DO UPDATE SET role = EXCLUDED.role,
        removed_at = CASE WHEN EXCLUDED.removed_at IS NOT NULL THEN EXCLUDED.removed_at ELSE hive_memberships.removed_at END;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER hive_selected_membership AFTER INSERT OR UPDATE OF team_id, role, removed_at ON members FOR EACH ROW EXECUTE FUNCTION hive_bridge_selected_membership();
CREATE OR REPLACE TRIGGER hive_dirty_member_knowledge AFTER UPDATE OF name ON members FOR EACH ROW EXECUTE FUNCTION hive_dirty_knowledge();
DROP FUNCTION IF EXISTS hive_dirty_member_knowledge();
DROP TABLE hive_cutover_rollback_state;
DELETE FROM _migrations WHERE name = '0029_multi_hive_cutover.sql';
