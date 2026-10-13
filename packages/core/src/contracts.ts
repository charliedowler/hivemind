import { z } from "zod";
import type { CaptureRuleInput } from "./capture-rules";
import type {
  LearningKind,
  LearningSource,
  FrictionArea,
  LearningLifecycle,
  OutcomeKind,
  CaptureEvidence,
} from "./schemas";

export type HiveContext = {
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
};

export type HiveMembership = {
  memberId: string;
  teamId: string;
  role: "member" | "admin";
  ownerMemberId: string | null;
  joinedAt: string;
  removedAt: string | null;
};

export type AgentOwnerBinding = {
  issuer: string;
  ownerSub: string;
  ownerMemberId: string;
  verifiedContactEmail: string;
};

export type HiveJoinPhrase = {
  phrase: string;
  generation: number;
  paused: boolean;
};

export type VoteCounts = { up: number; down: number; outdated: number };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | {
      type: "score";
      score: number;
      probabilities: Record<string, number>;
      legend: Record<string, string>;
      confidence: number;
    };
export type JevClassification = {
  model: string;
  latencyMs: number;
  answers: Record<string, JevAnswer>;
};

export type LearningView = {
  id: string;
  title: string;
  body: string;
  kind: LearningKind;
  tags: string[];
  repo: string | null;
  paths: string[];
  confidence: number;
  source: LearningSource;
  author: { id: string; name: string };
  pushCount: number;
  votes: VoteCounts;
  lifecycle?: LearningLifecycle;
  revision?: number;
  verifyAfter?: string | null;
  verifyBeforeUse?: boolean;
  supersededBy?: string | null;
  sessionRef?: string | null;
  captureFlagged?: boolean;
  captureRedacted?: boolean;
  captureRuleIds?: string[];
  captureCategories?: Record<string, boolean>;
  canConfirmCapture?: boolean;
  permalink?: string | null;
  slackChannel?: string;
  classification?: JevClassification | null;
  adminOutdated?: boolean;
  area?: FrictionArea | null;
  cost?: number | null;
  blocked?: boolean | null;
  workaround?: string | null;
  createdAt: string;
  updatedAt: string;
  lastPushedAt: string;
};

export type SearchSignals = {
  vector: number | null;
  fts: number;
  recency: number;
  votes: number;
  repoMatch: boolean;
  lifecycle?: number;
  verification?: number;
  relevance?: number;
};

export type SearchHit = LearningView & {
  score: number;
  signals: SearchSignals;
};

export type PushResult = { dropped: true; rule: CaptureRuleInput["kind"] } | {
  dropped?: false;
  id: string;
  merged: boolean;
  pushCount: number;
  redactions: number;
  learning: LearningView;
  inferred?: CaptureMetadata;
  correction?: { tool: "hive_correct"; id: string; revision: number };
  replayed?: boolean;
  decisions?: Pick<
    ConflictDecisionRecord,
    "id" | "decision" | "reason" | "confidence" | "model"
  >[];
};

export const askConfidenceLevels = ["high", "medium", "low"] as const;
export type AskConfidence = (typeof askConfidenceLevels)[number];

export type AskCitation = {
  id: string;
  title: string;
  why: string;
  source?: "slack";
  permalink?: string;
  date?: string;
};

export type AskResult = {
  answer: string;
  citations: AskCitation[];
  confidence: AskConfidence;
  gaps: string | null;
  synthesized: boolean;
};

export type CaptureMetadata = Pick<LearningView, "title" | "kind" | "tags" | "area" | "blocked" | "workaround" | "cost" | "confidence" | "repo" | "source" | "sessionRef" | "paths" | "verifyAfter" | "supersededBy"> & {
  context: Record<string, unknown>;
  supersedes: string[];
  relations: {id: string; relation: string; confidence: number}[];
  overrides: string[];
};
export type FeedbackResult = {
  id: string;
  votes: VoteCounts;
  receipt?: string;
  withdrawn?: boolean;
  classification?: OutcomeKind;
  vote?: "up" | "down" | "outdated" | null;
};
export type FeedbackHistoryEntry = {
  receipt: string;
  actor: string;
  action: "report" | "withdraw";
  outcome: string | null;
  classification: OutcomeKind | null;
  vote: "up" | "down" | "outdated" | null;
  evidence: CaptureEvidence | null;
  createdAt: string;
  current: boolean;
};

export type MemberView = {
  id: string;
  name: string;
  joinedAt: string;
  lastSeenAt: string | null;
  learningCount: number;
  email: string | null;
  emailVerified: boolean;
  role: "member" | "admin";
};

export type TeamOverview = {
  teamName: string;
  role: "member" | "admin";
  domains: string[];
  inviteExpiresAt: string;
  learningCount: number;
  memberCount: number;
  repos: string[];
};

export const teamSizes = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;

export const earlyAccessInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(120, "Keep your name to 120 characters or fewer."),
  email: z
    .email("Enter a valid email address.")
    .max(200, "Keep your email to 200 characters or fewer."),
  company: z
    .string()
    .trim()
    .max(160, "Keep the company name to 160 characters or fewer.")
    .default(""),
  teamSize: z.enum(teamSizes),
  source: z.string().trim().max(200).optional(),
});
export type EarlyAccessInput = z.infer<typeof earlyAccessInput>;

export const createTeamInput = z.object({
  teamName: z
    .string()
    .trim()
    .min(1, "Enter a team name.")
    .max(80, "Keep the team name to 80 characters or fewer."),
  memberName: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(80, "Keep your name to 80 characters or fewer."),
});
export type CreateTeamInput = z.infer<typeof createTeamInput>;

export const joinTeamInput = z.object({
  inviteCode: z
    .string()
    .trim()
    .min(4, "Enter the invite code from your team.")
    .max(64, "Check your invite code. It must be 64 characters or fewer."),
  memberName: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(80, "Keep your name to 80 characters or fewer."),
});
export type JoinTeamInput = z.infer<typeof joinTeamInput>;

export const signInInput = z.object({
  apiKey: z
    .string()
    .trim()
    .min(8, "Enter your saved API key.")
    .max(200, "Check your API key. It must be 200 characters or fewer."),
});
export type SignInInput = z.infer<typeof signInInput>;

export type FrictionSummary = {
  since: string;
  count: number;
  minutes: number;
  unmeasured: number;
  blocked: number;
  areas: { area: string; count: number; minutes: number; ids: string[] }[];
  recurring: { title: string; count: number; minutes: number; ids: string[] }[];
  cells: { id: string; title: string }[];
};

export type LearningConflict = {
  id: string;
  older: {
    id: string;
    title: string;
    body: string;
    author: string;
    revision: number;
  };
  newer: {
    id: string;
    title: string;
    body: string;
    author: string;
    revision: number;
  };
  relation: "update" | "contradiction";
  confidence: number;
  status: "candidate" | "accepted" | "rejected";
  reason: string;
  votes: number;
  voted: boolean;
  canAdmin: boolean;
  stale: boolean;
  createdAt: string;
};
export type LearningVersion = {
  revision: number;
  author: string;
  createdAt: string;
  content: Record<string, unknown>;
  diff: Record<string, { before: unknown; after: unknown }>;
};
export type KnowledgeEntry = {
  path: string;
  name: string;
  type: "directory" | "file";
};
export type KnowledgeListing = {
  path: string;
  revision: number;
  entries: KnowledgeEntry[];
};
export type KnowledgeFile = { path: string; revision: number; content: string };

export type ConflictDecisionRecord = {
  id: string;
  older: { id: string; title: string };
  newer: { id: string; title: string };
  decision:
    | "supersede"
    | "keep_both"
    | "keep_old"
    | "mark_outdated"
    | "retract_new"
    | "undecided"
    | "reversed";
  reason: string;
  confidence: number;
  model: string;
  jev: Record<string, JevAnswer> | null;
  latencyMs: number;
  author: string;
  repo: string | null;
  canReverse: boolean;
  canEditReason?: boolean;
  createdAt: string;
};
