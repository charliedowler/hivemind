import { z } from "zod";
import type { LearningKind, LearningSource, FrictionArea, LearningLifecycle } from "./schemas";

export type HiveContext = {
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
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
  classification?: JevClassification | null;
  adminOutdated?: boolean;
  area?: FrictionArea | null;
  cost?: number | null;
  blocked?: boolean;
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

export type PushResult = {
  id: string;
  merged: boolean;
  pushCount: number;
  redactions: number;
  learning: LearningView;
};

export const askConfidenceLevels = ["high", "medium", "low"] as const;
export type AskConfidence = (typeof askConfidenceLevels)[number];

export type AskCitation = { id: string; title: string; why: string };

export type AskResult = {
  answer: string;
  citations: AskCitation[];
  confidence: AskConfidence;
  gaps: string | null;
  synthesized: boolean;
};

export type FeedbackResult = { id: string; votes: VoteCounts };

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
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  company: z.string().trim().max(160).default(""),
  teamSize: z.enum(teamSizes),
  source: z.string().trim().max(200).optional(),
});
export type EarlyAccessInput = z.infer<typeof earlyAccessInput>;

export const createTeamInput = z.object({
  teamName: z.string().trim().min(1).max(80),
  memberName: z.string().trim().min(1).max(80),
});
export type CreateTeamInput = z.infer<typeof createTeamInput>;

export const joinTeamInput = z.object({
  inviteCode: z.string().trim().min(4).max(64),
  memberName: z.string().trim().min(1).max(80),
});
export type JoinTeamInput = z.infer<typeof joinTeamInput>;

export const signInInput = z.object({
  apiKey: z.string().trim().min(8).max(200),
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
  older: { id: string; title: string; body: string; author: string; revision: number };
  newer: { id: string; title: string; body: string; author: string; revision: number };
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
export type LearningVersion = { revision: number; author: string; createdAt: string; content: Record<string, unknown>; diff: Record<string, { before: unknown; after: unknown }> };
export type KnowledgeEntry = { path: string; name: string; type: "directory" | "file" };
export type KnowledgeListing = { path: string; revision: number; entries: KnowledgeEntry[] };
export type KnowledgeFile = { path: string; revision: number; content: string };
