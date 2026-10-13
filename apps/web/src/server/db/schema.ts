import {
  pgTable,
  jsonb,
  bigint,
  text,
  timestamp,
  integer,
  real,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  inviteExpiresAt: timestamp("invite_expires_at", {
    withTimezone: true,
  }).notNull(),
  createdAt: createdAt(),
});

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .references(() => teams.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  image: text("image"),
  hiveRegistration: text("hive_registration"),
  email: text("email").unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  role: text("role").notNull().default("member"),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  label: text("label").notNull().default("Agent key"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const webSessions = pgTable("web_sessions", {
  id: text("id").primaryKey(),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  teamId: text("team_id")
    .references(() => teams.id),
  tokenHash: text("token_hash").notNull().unique(),
  token: text("token").unique(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const learnings = pgTable("learnings", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  captureContext: jsonb("capture_context").notNull().default({}),
  captureCategories: jsonb("capture_categories").notNull().default({}),
  captureFlagged: boolean("capture_flagged").notNull().default(false),
  captureRedacted: boolean("capture_redacted").notNull().default(false),
  captureRuleIds: text("capture_rule_ids").array().notNull().default([]),
  classification: jsonb("classification"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  kind: text("kind").notNull(),
  source: text("source").notNull(),
  tags: text("tags").array().notNull().default([]),
  paths: text("paths").array().notNull().default([]),
  repo: text("repo"),
  area: text("area"),
  cost: integer("cost"),
  blocked: boolean("blocked").notNull().default(false),
  workaround: text("workaround"),
  confidence: real("confidence").notNull(),
  sessionRef: text("session_ref"),
  pushCount: integer("push_count").notNull().default(1),
  upVotes: integer("up_votes").notNull().default(0),
  downVotes: integer("down_votes").notNull().default(0),
  lifecycle: text("lifecycle").notNull().default("fresh"),
  verifyAfter: timestamp("verify_after", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  supersededBy: text("superseded_by"),
  adminOutdated: boolean("admin_outdated").notNull().default(false),
  outdatedVotes: integer("outdated_votes").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastPushedAt: timestamp("last_pushed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const learningPushes = pgTable("learning_pushes", {
  id: text("id").primaryKey(),
  learningId: text("learning_id")
    .notNull()
    .references(() => learnings.id),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  source: text("source").notNull(),
  sessionRef: text("session_ref"),
  area: text("area"),
  cost: integer("cost"),
  blocked: boolean("blocked").notNull().default(false),
  classification: jsonb("classification"),
  merged: boolean("merged").notNull(),
  createdAt: createdAt(),
});

export const feedback = pgTable(
  "feedback",
  {
    learningId: text("learning_id")
      .notNull()
      .references(() => learnings.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    vote: text("vote").notNull(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.learningId, table.memberId] })],
);

export const askLog = pgTable("ask_log", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  citedIds: text("cited_ids").array().notNull().default([]),
  classification: jsonb("classification"),
  synthesized: boolean("synthesized").notNull(),
  createdAt: createdAt(),
});

export const earlyAccess = pgTable("early_access", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull(),
  company: text("company"),
  teamSize: text("team_size"),
  source: text("source").default("landing"),
  createdAt: createdAt(),
});

export const learningVersions = pgTable(
  "learning_versions",
  {
    learningId: text("learning_id").notNull(),
    teamId: text("team_id").notNull(),
    revision: integer("revision").notNull(),
    memberId: text("member_id").notNull(),
    content: jsonb("content").notNull(),
    diff: jsonb("diff").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.learningId, table.teamId, table.revision] }),
  ],
);

export const learningSupersessions = pgTable("learning_supersessions", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  olderId: text("older_id").notNull(),
  newerId: text("newer_id").notNull(),
  olderRevision: integer("older_revision").notNull(),
  newerRevision: integer("newer_revision").notNull(),
  relation: text("relation").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status").notNull().default("candidate"),
  reason: text("reason").notNull(),
  decidedBy: text("decided_by"),
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const learningConflictVotes = pgTable(
  "learning_conflict_votes",
  {
    edgeId: text("edge_id").notNull(),
    teamId: text("team_id").notNull(),
    memberId: text("member_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.edgeId, table.teamId, table.memberId] }),
  ],
);

export const learningEvidence = pgTable("learning_evidence", {
  pushId: text("push_id").primaryKey(),
  teamId: text("team_id").notNull(),
  learningId: text("learning_id").notNull(),
  payload: jsonb("payload"),
  objectKey: text("object_key").notNull(),
  digest: text("digest").notNull(),
  bytes: integer("bytes").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  createdAt: createdAt(),
});
export const knowledgeState = pgTable("knowledge_state", {
  teamId: text("team_id").primaryKey(),
  revision: bigint("revision", { mode: "number" }).notNull(),
  publishedRevision: bigint("published_revision", { mode: "number" }).notNull(),
  manifest: jsonb("manifest").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  nextVerifyAt: timestamp("next_verify_at", { withTimezone: true }),
});
export const knowledgeSnapshots = pgTable("knowledge_snapshots", {
  tokenHash: text("token_hash").primaryKey(),
  teamId: text("team_id").notNull(),
  memberId: text("member_id").notNull(),
  revision: bigint("revision", { mode: "number" }).notNull(),
  objectKey: text("object_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const captureRules = pgTable("capture_rules", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  memberId: text("member_id").references(() => members.id),
  createdBy: text("created_by").notNull().references(() => members.id),
  name: text("name").notNull(),
  scope: text("scope").notNull(),
  kind: text("kind").notNull(),
  action: text("action").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").notNull(),
  source: text("source").notNull().default("web"),
  naturalText: text("natural_text"),
  revision: integer("revision").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const captureRulePreviews = pgTable("capture_rule_previews", {
  tokenHash: text("token_hash").primaryKey(),
  ruleId: text("rule_id").notNull(),
  teamId: text("team_id").notNull(),
  memberId: text("member_id").notNull(),
  ruleRevision: integer("rule_revision").notNull(),
  cells: jsonb("cells").notNull(),
  nextCursor: text("next_cursor"),
  scanned: integer("scanned").notNull(),
  truncated: boolean("truncated").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const captureRuleApplications = pgTable("capture_rule_applications", {
  id: text("id").primaryKey(),
  instructionId: text("instruction_id"),
  teamId: text("team_id").notNull(),
  ruleId: text("rule_id").notNull(),
  learningId: text("learning_id").notNull(),
  memberId: text("member_id").notNull(),
  previousState: text("previous_state").notNull(),
  action: text("action").notNull().default("drop"),
  ruleName: text("rule_name").notNull(),
  beforeSnapshot: jsonb("before_snapshot").notNull().default({}),
  appliedRevision: integer("applied_revision").notNull(),
  reasonCode: text("reason_code").notNull().default("capture_rule"),
  createdAt: createdAt(),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  reversedBy: text("reversed_by"),
  reversalReason: text("reversal_reason"),
});

export const slackDigestSchedules = pgTable("slack_digest_schedules", {
  id: text("id").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id),
  channelId: text("channel_id").notNull(),
  channelName: text("channel_name").notNull(),
  cadence: text("cadence").notNull(),
  weekday: integer("weekday").notNull().default(1),
  monthDay: integer("month_day").notNull().default(1),
  localTime: text("local_time").notNull(),
  timezone: text("timezone").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  includeLearnings: boolean("include_learnings").notNull().default(true),
  includeInsights: boolean("include_insights").notNull().default(true),
  includeFriction: boolean("include_friction").notNull().default(true),
  includeDecisions: boolean("include_decisions").notNull().default(true),
  skipEmpty: boolean("skip_empty").notNull().default(true),
  lastPostedAt: timestamp("last_posted_at", { withTimezone: true }),
  lastCursor: timestamp("last_cursor", { withTimezone: true }).notNull(),
  coverageStartAt: timestamp("coverage_start_at", {
    withTimezone: true,
  }).notNull(),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
  lastSlotAt: timestamp("last_slot_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const slackDigestPosts = pgTable("slack_digest_posts", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  scheduleId: text("schedule_id").notNull(),
  slotAt: timestamp("slot_at", { withTimezone: true }).notNull(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  slackTs: text("slack_ts"),
  permalink: text("permalink"),
  sinceCursor: timestamp("since_cursor", { withTimezone: true }).notNull(),
  untilCursor: timestamp("until_cursor", { withTimezone: true }),
  counts: jsonb("counts").notNull().default({}),
  error: text("error"),
});
export const slackDigestReceipts = pgTable(
  "slack_digest_receipts",
  {
    scheduleId: text("schedule_id").notNull(),
    teamId: text("team_id").notNull(),
    sourceKey: text("source_key").notNull(),
    postId: text("post_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.scheduleId, table.sourceKey] })],
);
export const slackDigestProposals = pgTable("slack_digest_proposals", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  memberId: text("member_id").notNull(),
  channelId: text("channel_id").notNull(),
  schedule: jsonb("schedule").notNull(),
  restatement: text("restatement").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmedScheduleId: text("confirmed_schedule_id"),
  createdAt: createdAt(),
});

export const captureRuleInstructions = pgTable("capture_rule_instructions", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  memberId: text("member_id").notNull(),
  source: text("source").notNull(),
  channelId: text("channel_id"),
  threadTs: text("thread_ts"),
  decision: jsonb("decision").notNull(),
  outcome: text("outcome").notNull(),
  ruleId: text("rule_id"),
  ruleRevision: integer("rule_revision"),
  ruleSnapshot: jsonb("rule_snapshot"),
  restatement: text("restatement").notNull(),
  naturalText: text("natural_text").notNull(),
  question: text("question"),
  jobStatus: text("job_status").notNull().default("complete"),
  jobCursor: text("job_cursor"),
  undoCursor: text("undo_cursor"),
  counts: jsonb("counts").notNull().default({scanned: 0, matched: 0, applied: 0, skipped: 0, restored: 0, retained: 0}),
  undoUntil: timestamp("undo_until", {withTimezone: true}),
  undoStartedAt: timestamp("undo_started_at", {withTimezone: true}),
  undoneAt: timestamp("undone_at", {withTimezone: true}),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", {withTimezone: true}).notNull().defaultNow(),
});
