DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM owner_capture_policy_history WHERE capture_mode = 'everything' OR work_areas <> '') OR EXISTS (SELECT 1 FROM owner_capture_policies WHERE work_areas <> '') THEN
    RAISE EXCEPTION 'Owners saved a capture mode or work areas; rollback would discard their choice';
  END IF;
END $$;
ALTER TABLE owner_capture_policy_history DROP COLUMN work_areas, DROP COLUMN capture_mode;
ALTER TABLE owner_capture_policies DROP COLUMN work_areas, DROP COLUMN capture_mode;
DELETE FROM _migrations WHERE name = '0035_capture_by_default.sql';
