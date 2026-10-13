BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM feedback_receipts) THEN
    RAISE EXCEPTION 'Export and preserve outcome audit history before rollback';
  END IF;
END $$;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_receipt_actor_fk;
ALTER TABLE feedback DROP COLUMN IF EXISTS receipt_id;
DROP TABLE IF EXISTS feedback_receipts;
DELETE FROM _migrations WHERE name = '0023_outcome_feedback.sql';
COMMIT;
