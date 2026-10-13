SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'hive_cutover_rollback_state' AND relnamespace = (SELECT relnamespace FROM pg_class WHERE oid = 'members'::regclass)) THEN
    RAISE EXCEPTION 'Refuse lossy rollback: roll back 0029 before 0028';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM owner_capture_policies WHERE revision > 0 OR cardinality(include_patterns) > 0 OR cardinality(exclude_patterns) > 0) OR EXISTS (SELECT 1 FROM knowledge_snapshots WHERE cardinality(audience_team_ids) > 1) OR EXISTS (SELECT 1 FROM owner_capture_policy_history) OR EXISTS (SELECT 1 FROM capture_policy_delegations) OR EXISTS (SELECT 1 FROM project_sharing_grants) OR EXISTS (SELECT 1 FROM learning_shares) OR EXISTS (SELECT 1 FROM feedback f JOIN learnings l ON l.id = f.learning_id WHERE f.team_id <> l.team_id) OR EXISTS (SELECT 1 FROM feedback_receipts f JOIN learnings l ON l.id = f.learning_id WHERE f.team_id <> l.team_id) THEN
    RAISE EXCEPTION 'Refuse lossy rollback of project selection, publication or audience feedback';
  END IF;
END $$;
ALTER TABLE knowledge_snapshots DROP COLUMN IF EXISTS audience_team_ids;
DROP TRIGGER IF EXISTS hive_withdraw_membership_publications ON hive_memberships;
DROP FUNCTION IF EXISTS hive_withdraw_membership_publications();
DROP TRIGGER IF EXISTS hive_withdraw_disabled_owner_publications ON members;
DROP FUNCTION IF EXISTS hive_withdraw_disabled_owner_publications();
DROP VIEW IF EXISTS learning_audience_cells;
DROP TRIGGER IF EXISTS hive_withdraw_restricted_original ON learnings;
DROP FUNCTION IF EXISTS hive_withdraw_restricted_original();
DROP TRIGGER IF EXISTS hive_same_owner_relation ON learning_supersessions;
DROP FUNCTION IF EXISTS hive_same_owner_relation();
DROP TABLE IF EXISTS learning_shares;
DROP FUNCTION IF EXISTS hive_validate_publication();
DROP FUNCTION IF EXISTS hive_dirty_publication();
DROP TABLE IF EXISTS project_sharing_grants;
DROP TABLE IF EXISTS owner_capture_policy_history;
DROP TABLE IF EXISTS capture_policy_delegations;
DROP TABLE IF EXISTS owner_capture_policies;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_cell_identity_fk;
ALTER TABLE feedback_receipts DROP CONSTRAINT IF EXISTS feedback_receipts_cell_identity_fk;
ALTER TABLE feedback DROP CONSTRAINT feedback_pkey;
ALTER TABLE feedback ADD PRIMARY KEY (learning_id, member_id);
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT * FROM hive_sharing_legacy_constraints LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', c.table_name, c.constraint_name, c.definition);
  END LOOP;
END $$;
DROP TABLE hive_sharing_legacy_constraints;
DELETE FROM _migrations WHERE name = '0028_project_sharing.sql';
