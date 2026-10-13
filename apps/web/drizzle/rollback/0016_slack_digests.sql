SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE slack_digest_schedules, slack_digest_posts, slack_digest_proposals, slack_digest_receipts IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM slack_digest_posts) OR EXISTS(SELECT 1 FROM slack_digest_schedules) OR EXISTS(SELECT 1 FROM slack_digest_proposals) THEN
  RAISE EXCEPTION 'Digest records exist. Preserve them before removing these tables.';
 END IF;
END $$;
DROP TABLE IF EXISTS slack_digest_receipts;
DROP TABLE IF EXISTS slack_digest_proposals;
DROP TABLE IF EXISTS slack_digest_posts;
DROP TABLE IF EXISTS slack_digest_schedules;
DELETE FROM _migrations WHERE name='0016_slack_digests.sql';
