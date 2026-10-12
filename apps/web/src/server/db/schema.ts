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
    .notNull()
    .references(() => teams.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
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
    .notNull()
    .references(() => teams.id),
  tokenHash: text("token_hash").notNull().unique(),
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

export const learningVersions = pgTable("learning_versions", {
  learningId: text("learning_id").notNull(),
  teamId: text("team_id").notNull(),
  revision: integer("revision").notNull(),
  memberId: text("member_id").notNull(),
  content: jsonb("content").notNull(),
  diff: jsonb("diff").notNull(),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.learningId, table.teamId, table.revision] })]);

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

export const learningConflictVotes = pgTable("learning_conflict_votes", {
  edgeId: text("edge_id").notNull(),
  teamId: text("team_id").notNull(),
  memberId: text("member_id").notNull(),
  createdAt: createdAt(),
}, (table) => [primaryKey({ columns: [table.edgeId, table.teamId, table.memberId] })]);

export const learningEvidence = pgTable("learning_evidence", {
  pushId: text("push_id").primaryKey(), teamId: text("team_id").notNull(), learningId: text("learning_id").notNull(), payload: jsonb("payload"), objectKey: text("object_key").notNull(), digest: text("digest").notNull(), bytes: integer("bytes").notNull(), uploadedAt: timestamp("uploaded_at", { withTimezone: true }), createdAt: createdAt(),
});
export const knowledgeState = pgTable("knowledge_state", {
  teamId: text("team_id").primaryKey(), revision: bigint("revision", { mode: "number" }).notNull(), publishedRevision: bigint("published_revision", { mode: "number" }).notNull(), manifest: jsonb("manifest").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), nextVerifyAt: timestamp("next_verify_at", { withTimezone: true }),
});
export const knowledgeSnapshots = pgTable("knowledge_snapshots", {
  tokenHash: text("token_hash").primaryKey(), teamId: text("team_id").notNull(), memberId: text("member_id").notNull(), revision: bigint("revision", { mode: "number" }).notNull(), objectKey: text("object_key").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: createdAt(),
});
