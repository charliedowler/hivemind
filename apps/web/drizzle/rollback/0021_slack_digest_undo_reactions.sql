SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM slack_digest_instructions WHERE reaction='white_check_mark') THEN
  RAISE EXCEPTION 'Undo reaction history exists; rollback refused';
 END IF;
END $$;
ALTER TABLE slack_digest_instructions DROP CONSTRAINT IF EXISTS slack_digest_instructions_reaction_check;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='slack_digest_instructions'::regclass AND conname='slack_digest_instructions_reaction_check') THEN
  ALTER TABLE slack_digest_instructions ADD CONSTRAINT slack_digest_instructions_reaction_check CHECK (reaction IS NULL OR reaction='+1');
 END IF;
END $$;
