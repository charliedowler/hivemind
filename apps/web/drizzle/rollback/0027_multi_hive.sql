SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM members WHERE provisional OR disabled_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM hive_join_phrases)
    OR EXISTS (SELECT 1 FROM hive_join_capabilities)
    OR EXISTS (SELECT 1 FROM learnings l JOIN teams t ON t.id = l.team_id WHERE t.personal_owner_member_id IS NOT NULL OR l.owner_member_id <> l.member_id)
    OR EXISTS (SELECT 1 FROM hive_memberships h JOIN teams t ON t.id = h.team_id JOIN members m ON m.id = h.member_id WHERE t.personal_owner_member_id IS NULL AND (m.team_id IS DISTINCT FROM h.team_id OR m.role <> h.role OR m.removed_at IS DISTINCT FROM h.removed_at))
    OR EXISTS (SELECT 1 FROM capture_rules c JOIN teams t ON t.id = c.team_id WHERE t.personal_owner_member_id IS NOT NULL AND (c.id NOT LIKE 'crule_default_%' OR NOT c.enabled OR c.revision <> 1))
    OR EXISTS (SELECT 1 FROM web_sessions s JOIN teams t ON t.id = s.team_id WHERE t.personal_owner_member_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM api_keys k JOIN teams t ON t.id = k.team_id WHERE t.personal_owner_member_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM knowledge_snapshots s JOIN teams t ON t.id = s.team_id WHERE t.personal_owner_member_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM auth_oauth_consent c JOIN teams t ON t.id = c.reference_id WHERE t.personal_owner_member_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM auth_oauth_refresh_token c JOIN teams t ON t.id = c.reference_id WHERE t.personal_owner_member_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM auth_oauth_access_token c JOIN teams t ON t.id = c.reference_id WHERE t.personal_owner_member_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Refuse lossy multi-hive rollback'; END IF;
END $$;
DROP TRIGGER IF EXISTS hive_selected_membership ON members;
DROP TRIGGER IF EXISTS hive_learning_owner ON learnings;
DROP FUNCTION IF EXISTS hive_bridge_selected_membership();
DROP FUNCTION IF EXISTS hive_stamp_learning_owner();
DROP FUNCTION IF EXISTS hive_ensure_personal_hive(text);
ALTER TABLE learnings DROP COLUMN owner_member_id;
DELETE FROM capture_rules WHERE team_id IN (SELECT id FROM teams WHERE personal_owner_member_id IS NOT NULL);
DELETE FROM teams WHERE personal_owner_member_id IS NOT NULL;
ALTER TABLE team_domains DROP CONSTRAINT team_domains_membership_fk;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM hive_identity_legacy_constraints LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.table_name, item.constraint_name);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.table_name, item.constraint_name, item.definition);
  END LOOP;
END $$;
ALTER TABLE members DROP CONSTRAINT members_team_id_fkey;
ALTER TABLE members ADD CONSTRAINT members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
ALTER TABLE capture_rules DROP CONSTRAINT capture_rules_team_id_fkey;
ALTER TABLE capture_rules ADD CONSTRAINT capture_rules_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id);
ALTER TABLE auth_oauth_access_token DROP CONSTRAINT auth_oauth_access_token_membership_fk;
ALTER TABLE auth_oauth_refresh_token DROP CONSTRAINT auth_oauth_refresh_token_membership_fk;
ALTER TABLE auth_oauth_consent DROP CONSTRAINT auth_oauth_consent_membership_fk;
DROP TABLE hive_join_capabilities, hive_join_phrases, agent_owner_bindings, hive_memberships, hive_identity_legacy_constraints;
DROP FUNCTION hive_check_membership_identity(), hive_check_owner_identity();
ALTER TABLE teams DROP COLUMN personal_owner_member_id, DROP COLUMN join_paused, DROP COLUMN join_domain_policy, DROP COLUMN join_generation;
ALTER TABLE members DROP COLUMN disabled_at, DROP COLUMN provisional;
ALTER TABLE auth_accounts DROP COLUMN owner_issuer;
DELETE FROM _migrations WHERE name = '0027_multi_hive.sql';
