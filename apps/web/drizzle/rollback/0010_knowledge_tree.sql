BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE learning_evidence IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM learning_evidence) THEN RAISE EXCEPTION 'Export evidence and its private object references before rollback'; END IF;
END $$;
DROP TRIGGER IF EXISTS hive_dirty_member_knowledge ON members;
DROP TRIGGER IF EXISTS hive_dirty_knowledge ON learnings;
DROP FUNCTION IF EXISTS hive_dirty_knowledge();
DROP TABLE IF EXISTS knowledge_snapshots;
DROP TABLE IF EXISTS knowledge_state;
DROP TABLE IF EXISTS learning_evidence;
DROP INDEX IF EXISTS learning_pushes_id_team_idx;
DELETE FROM _migrations WHERE name = '0010_knowledge_tree.sql';
COMMIT;
