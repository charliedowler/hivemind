CREATE TABLE hive_join_requests (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  phrase_generation integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','expired')),
  decided_by text REFERENCES members(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  undo_action_id text REFERENCES slack_tool_actions(id),
  undone_at timestamptz,
  membership_created boolean NOT NULL DEFAULT false,
  approved_joined_at timestamptz,
  decline_emailed_at timestamptz,
  UNIQUE (team_id,id),
  FOREIGN KEY (team_id,phrase_generation) REFERENCES hive_join_phrases(team_id,generation),
  CHECK ((status IN ('approved','declined')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX hive_join_requests_pending_member_idx ON hive_join_requests(team_id,member_id) WHERE status='pending';
CREATE INDEX hive_join_requests_pending_expiry_idx ON hive_join_requests(expires_at) WHERE status='pending';
CREATE INDEX hive_join_requests_history_idx ON hive_join_requests(team_id,member_id,created_at DESC);
CREATE TABLE hive_join_request_notifications (
  request_id text NOT NULL REFERENCES hive_join_requests(id) ON DELETE CASCADE,
  admin_member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','uncertain')),
  channel_id text,
  thread_ts text,
  sent_at timestamptz,
  PRIMARY KEY (request_id,admin_member_id)
);
CREATE OR REPLACE FUNCTION hive_validate_join_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE id=NEW.member_id AND actor_type='human' AND email_verified AND NOT provisional AND disabled_at IS NULL AND lower(email)=NEW.email) THEN
    RAISE EXCEPTION 'Join requests require a verified human';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id=NEW.team_id AND personal_owner_member_id IS NULL) THEN
    RAISE EXCEPTION 'Join requests require an organisation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hive_join_request_identity BEFORE INSERT ON hive_join_requests FOR EACH ROW EXECUTE FUNCTION hive_validate_join_request();
