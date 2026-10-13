SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE join_share_offers ADD COLUMN decision text CHECK (decision IN ('yes', 'chosen', 'not_now'));
ALTER TABLE join_share_offers ADD CONSTRAINT join_share_decision_answer CHECK (decision IS NULL OR (answered_at IS NOT NULL AND human_instruction IS NOT NULL));
