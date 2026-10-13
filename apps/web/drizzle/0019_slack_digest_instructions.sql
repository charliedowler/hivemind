SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE slack_digest_schedules ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE slack_digest_schedules ADD COLUMN IF NOT EXISTS instruction_revision integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS slack_digest_instructions (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id),
 member_id text NOT NULL,
 channel_id text NOT NULL,
 thread_ts text NOT NULL,
 message_ts text NOT NULL,
 action text NOT NULL CHECK (action IN ('set','disable','undo')),
 schedule_id text NOT NULL,
 before_schedule jsonb,
 after_revision integer NOT NULL,
 reply text NOT NULL,
 reaction text CHECK (reaction IS NULL OR reaction='+1'),
 created_at timestamptz NOT NULL DEFAULT now(),
 reversed_at timestamptz,
 UNIQUE(team_id,channel_id,message_ts),
 FOREIGN KEY(member_id,team_id) REFERENCES members(id,team_id),
 FOREIGN KEY(schedule_id,team_id) REFERENCES slack_digest_schedules(id,team_id)
);
CREATE INDEX IF NOT EXISTS slack_digest_instructions_undo ON slack_digest_instructions(team_id,member_id,channel_id,thread_ts,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS slack_digest_instruction_decisions ON slack_decisions(team_id,channel_id,message_ts,policy_version) WHERE policy_version='hive-digest-actions-1';
