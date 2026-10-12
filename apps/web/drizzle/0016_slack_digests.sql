SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS slack_digest_schedules (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id),
 channel_id text NOT NULL,
 channel_name text NOT NULL,
 cadence text NOT NULL CHECK(cadence IN ('daily','weekdays','weekly','fortnightly','monthly')),
 weekday integer NOT NULL DEFAULT 1 CHECK(weekday BETWEEN 0 AND 6),
 month_day integer NOT NULL DEFAULT 1 CHECK(month_day BETWEEN 1 AND 31),
 local_time text NOT NULL CHECK(local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 timezone text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 include_learnings boolean NOT NULL DEFAULT true,
 include_insights boolean NOT NULL DEFAULT true,
 include_friction boolean NOT NULL DEFAULT true,
 include_decisions boolean NOT NULL DEFAULT true,
 skip_empty boolean NOT NULL DEFAULT true,
 last_posted_at timestamptz,
 coverage_start_at timestamptz NOT NULL DEFAULT now() - interval '7 days',
 last_cursor timestamptz NOT NULL DEFAULT now() - interval '7 days',
 next_due_at timestamptz NOT NULL,
 last_slot_at timestamptz,
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,team_id),
 FOREIGN KEY(created_by,team_id) REFERENCES members(id,team_id),
 CHECK(include_learnings OR include_insights OR include_friction OR include_decisions)
);
CREATE INDEX IF NOT EXISTS slack_digest_due_idx ON slack_digest_schedules(next_due_at,id) WHERE enabled;
CREATE TABLE IF NOT EXISTS slack_digest_posts (
 id text PRIMARY KEY,
 team_id text NOT NULL,
 schedule_id text NOT NULL,
 slot_at timestamptz NOT NULL,
 trigger text NOT NULL CHECK(trigger IN ('scheduled','manual')),
 status text NOT NULL CHECK(status IN ('running','posted','skipped_empty','failed','uncertain')),
 started_at timestamptz NOT NULL DEFAULT now(),
 posted_at timestamptz,
 slack_ts text,
 permalink text,
 since_cursor timestamptz NOT NULL,
 until_cursor timestamptz,
 counts jsonb NOT NULL DEFAULT '{}',
 error text,
 UNIQUE(id,team_id),
 UNIQUE(schedule_id,slot_at),
 FOREIGN KEY(schedule_id,team_id) REFERENCES slack_digest_schedules(id,team_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS slack_digest_one_running_idx ON slack_digest_posts(schedule_id) WHERE status='running';
CREATE INDEX IF NOT EXISTS slack_digest_history_idx ON slack_digest_posts(team_id,schedule_id,started_at DESC);
CREATE TABLE IF NOT EXISTS slack_digest_proposals (
 id text PRIMARY KEY,
 team_id text NOT NULL REFERENCES teams(id),
 member_id text NOT NULL,
 channel_id text NOT NULL,
 schedule jsonb NOT NULL,
 restatement text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
 confirmed_schedule_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(member_id,team_id) REFERENCES members(id,team_id),
 FOREIGN KEY(confirmed_schedule_id,team_id) REFERENCES slack_digest_schedules(id,team_id)
);
CREATE TABLE IF NOT EXISTS slack_digest_receipts (
 schedule_id text NOT NULL,
 team_id text NOT NULL,
 source_key text NOT NULL,
 post_id text NOT NULL,
 PRIMARY KEY(schedule_id,source_key),
 FOREIGN KEY(schedule_id,team_id) REFERENCES slack_digest_schedules(id,team_id),
 FOREIGN KEY(post_id,team_id) REFERENCES slack_digest_posts(id,team_id)
);
