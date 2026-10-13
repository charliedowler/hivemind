import { z } from "zod";

export const learningKinds = [
  "learning",
  "gotcha",
  "decision",
  "snippet",
  "incident",
  "insight",
  "friction",
] as const;
export const frictionAreas = [
  "repo",
  "tool",
  "process",
  "docs",
  "environment",
  "people",
] as const;
export const frictionAreaSchema = z.enum(frictionAreas);
export type FrictionArea = z.infer<typeof frictionAreaSchema>;
export const lifecycleStates = [
  "fresh",
  "confirmed",
  "superseded",
  "outdated",
  "retracted",
] as const;
export type LearningLifecycle = (typeof lifecycleStates)[number];

export const learningSources = [
  "claude-code",
  "codex",
  "manual",
  "slack",
] as const;
export const feedbackVotes = ["up", "down", "outdated"] as const;

export const learningKindSchema = z.enum(learningKinds);
export const learningSourceSchema = z.enum(learningSources);
export const feedbackVoteSchema = z.enum(feedbackVotes);

export type LearningKind = z.infer<typeof learningKindSchema>;
export type LearningSource = z.infer<typeof learningSourceSchema>;
export type FeedbackVote = z.infer<typeof feedbackVoteSchema>;

export const captureEvidenceSchema = z.union([
  z.string().trim().min(1).max(50000),
  z.object({
    session_excerpt: z.string().max(50000).optional(),
    diff: z.string().max(50000).optional(),
    command_output: z.string().max(50000).optional(),
  }),
]);
export type CaptureEvidence = z.infer<typeof captureEvidenceSchema>;

export const captureContextSchema = z.object({
  repo: z.string().trim().max(2000).optional(),
  remote: z.string().trim().max(2000).optional(),
  cwd: z.string().trim().max(4000).optional(),
  home: z.string().trim().max(4000).optional(),
  branch: z.string().trim().max(500).optional(),
  agent: z.string().trim().min(1).max(120).optional(),
  sessionType: z.string().trim().min(1).max(120).optional(),
  sessionRef: z.string().trim().max(2000).optional(),
  paths: z.array(z.string().max(4000)).max(20).optional(),
});

export const hivePushInput = z
  .object({
    observation: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .optional()
      .describe(
        "One fact in your own words. Attach evidence and the runtime context you already know.",
      ),
    evidence: captureEvidenceSchema.optional(),
    context: captureContextSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(20000).optional(),
    kind: learningKindSchema.optional(),
    tags: z.array(z.string().max(120)).max(12).optional(),
    area: frictionAreaSchema.optional(),
    cost: z
      .number()
      .int()
      .min(0)
      .max(1000000)
      .nullable()
      .optional()
      .describe("Measured minutes lost; null means unmeasured."),
    blocked: z
      .boolean()
      .nullable()
      .optional()
      .describe("True or false only when known; null means unknown."),
    workaround: z.string().trim().max(4000).nullable().optional(),
    confidence: z.number().min(0).max(1).optional(),
    source: learningSourceSchema.optional(),
    ...captureContextSchema.shape,
    supersedes: z
      .string()
      .regex(/^lrn_[a-z2-7]{12}$/)
      .optional(),
    verify_after: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    (value) => Boolean(value.observation || (value.title && value.body)),
    {
      message: "Supply an observation, or a title and body.",
    },
  );

export const hiveCorrectInput = z
  .object({
    id: z.string().regex(/^lrn_[a-z2-7]{12}$/),
    revision: z
      .number()
      .int()
      .positive()
      .describe("The revision returned with the saved cell."),
    observation: z.string().trim().min(1).max(20000).optional(),
    retract: z.literal(true).optional(),
    evidence: captureEvidenceSchema.optional(),
  })
  .refine((value) => Boolean(value.observation) !== Boolean(value.retract), {
    message: "Supply an observation or retract: true.",
  });
export type HiveCorrectInput = z.infer<typeof hiveCorrectInput>;
export const outcomeKinds = [
  "useful",
  "contradicted",
  "stale",
  "inconclusive",
] as const;
export type OutcomeKind = (typeof outcomeKinds)[number];
export const hiveOutcomeInput = z.object({
  id: z.string().regex(/^lrn_[a-z2-7]{12}$/),
  outcome: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe(
      "The result of using this cell, with a cited check or failure. Retrieval alone is not an outcome.",
    ),
  evidence: captureEvidenceSchema.optional(),
});
export type HiveOutcomeInput = z.infer<typeof hiveOutcomeInput>;

export const hiveSearchInput = z.object({
  include_history: z
    .boolean()
    .optional()
    .describe(
      "Include unhelpful, contradicted, superseded, outdated and retracted cells for investigation.",
    ),
  query: z
    .string()
    .min(1)
    .max(500)
    .describe("The task, error, or topic to search for."),
  repo: z
    .string()
    .optional()
    .describe(
      "Boost results from this repository, such as owner/name. Other repositories can still match.",
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe("Limit results to these topic tags."),
  kind: learningKindSchema
    .optional()
    .describe("Limit results to one learning kind."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(8)
    .describe("The maximum number of results, from 1 to 25."),
});

export const hiveAskInput = z.object({
  include_history: hiveSearchInput.shape.include_history,
  question: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "A question to answer using the team's shared learnings, with citations.",
    ),
  repo: z
    .string()
    .optional()
    .describe("Focus the answer on a repository, such as owner/name."),
});

export const hiveRecentInput = z.object({
  include_history: hiveSearchInput.shape.include_history,
  since: z
    .union([
      z.iso.datetime({ offset: true }),
      z.string().regex(/^[1-9]\d*(?:m|h|d|w)$/),
    ])
    .default("24h")
    .describe(
      "An ISO 8601 datetime or a positive relative duration in minutes, hours, days, or weeks, such as 24h or 7d.",
    ),
  repo: z
    .string()
    .optional()
    .describe("Limit the catch-up to a repository, such as owner/name."),
  kind: learningKindSchema
    .optional()
    .describe("Limit results to one learning kind."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("The maximum number of recent learnings, from 1 to 50."),
});

export const hiveFeedbackInput = z
  .object({
    id: z.string().describe("The cell you used."),
    vote: feedbackVoteSchema.optional(),
    note: z.string().max(1000).optional(),
    withdraw: z.literal(true).optional(),
    receipt: z
      .string()
      .regex(/^fbr_[a-z2-7]{12}$/)
      .optional()
      .describe(
        "Use the returned receipt to withdraw that feedback. A replaced receipt cannot remove newer feedback.",
      ),
  })
  .refine((value) => Boolean(value.vote) !== Boolean(value.withdraw), {
    message: "Supply a vote or withdraw: true.",
  });

export type HivePushInput = z.infer<typeof hivePushInput>;
export type HiveSearchInput = z.infer<typeof hiveSearchInput>;
export type HiveAskInput = z.infer<typeof hiveAskInput>;
export type HiveRecentInput = z.infer<typeof hiveRecentInput>;
export type HiveFeedbackInput = z.infer<typeof hiveFeedbackInput>;

export const hiveBrowseInput = z.object({
  path: z.string().max(500).default(""),
});
export const hiveReadInput = z.object({ path: z.string().min(1).max(500) });
export const learningEditInput = z.object({
  revision: z.number().int().positive(),
  observation: z.string().trim().min(1).max(20000).optional(),
  evidence: captureEvidenceSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  verify_after: z.iso.datetime({ offset: true }).optional(),
  lifecycle: z.enum(["fresh", "confirmed", "outdated", "retracted"]).optional(),
});

export const hiveSlackSearchInput = z.object({
  query: z.string().min(1).max(500),
  channel: z.string().max(100).optional(),
  since: z.string().max(80).optional(),
  limit: z.number().int().min(1).max(30).default(8),
});
export type HiveSlackSearchInput = z.infer<typeof hiveSlackSearchInput>;
