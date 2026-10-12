SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM conflict_decisions) THEN
    RAISE EXCEPTION 'Preserve decision history before rollback';
  END IF;
END $$;
DROP TABLE IF EXISTS conflict_decisions;
