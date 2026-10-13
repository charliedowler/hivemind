DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM project_sharing_grants WHERE grant_kind = 'all_selected') THEN
    RAISE EXCEPTION 'All-selected sharing exists; rollback would discard human consent';
  END IF;
END $$;
ALTER TABLE project_sharing_grants DROP CONSTRAINT project_sharing_grant_kind_pattern, DROP COLUMN grant_kind;
DELETE FROM _migrations WHERE name = '0032_all_selected_sharing.sql';
