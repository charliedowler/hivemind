SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE project_sharing_grants ADD COLUMN grant_kind text NOT NULL DEFAULT 'project' CHECK (grant_kind IN ('project', 'all_selected'));
ALTER TABLE project_sharing_grants ADD CONSTRAINT project_sharing_grant_kind_pattern CHECK (grant_kind <> 'all_selected' OR repo_pattern = '*');
