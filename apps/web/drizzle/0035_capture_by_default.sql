SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE owner_capture_policies ADD COLUMN capture_mode text NOT NULL DEFAULT 'everything' CHECK (capture_mode IN ('everything', 'selected'));
UPDATE owner_capture_policies SET capture_mode = 'selected' WHERE cardinality(include_patterns) > 0;
ALTER TABLE owner_capture_policies ADD COLUMN work_areas text NOT NULL DEFAULT '' CHECK (length(work_areas) <= 300);
ALTER TABLE owner_capture_policy_history ADD COLUMN capture_mode text NOT NULL DEFAULT 'selected' CHECK (capture_mode IN ('everything', 'selected'));
ALTER TABLE owner_capture_policy_history ALTER COLUMN capture_mode DROP DEFAULT;
ALTER TABLE owner_capture_policy_history ADD COLUMN work_areas text NOT NULL DEFAULT '' CHECK (length(work_areas) <= 300);
