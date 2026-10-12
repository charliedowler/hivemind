import { z } from "zod";

export const learningKinds = [
  "learning",
  "gotcha",
  "decision",
  "snippet",
  "incident",
] as const;
export const learningSources = ["claude-code", "codex", "manual"] as const;
export const feedbackVotes = ["up", "down", "outdated"] as const;

export const learningKindSchema = z.enum(learningKinds);
export const learningSourceSchema = z.enum(learningSources);
export const feedbackVoteSchema = z.enum(feedbackVotes);

export type LearningKind = z.infer<typeof learningKindSchema>;
export type LearningSource = z.infer<typeof learningSourceSchema>;
export type FeedbackVote = z.infer<typeof feedbackVoteSchema>;

export const hivePushInput = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .describe("A short, specific title for the learning."),
  body: z
    .string()
    .min(1)
    .max(20000)
    .describe("The learning in Markdown, including context and evidence."),
  kind: learningKindSchema
    .default("learning")
    .describe("The kind of knowledge being shared."),
  tags: z
    .array(z.string())
    .max(12)
    .default([])
    .describe("Up to 12 topic tags that help teammates find this learning."),
  repo: z
    .string()
    .optional()
    .describe("The related repository, such as owner/name."),
  paths: z
    .array(z.string())
    .max(20)
    .default([])
    .describe("Up to 20 repository-relative paths related to the learning."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .default(0.7)
    .describe("Confidence in the learning, from 0 to 1."),
  source: learningSourceSchema
    .default("manual")
    .describe("The agent or person sharing the learning."),
  sessionRef: z
    .string()
    .optional()
    .describe("An optional reference to the originating agent session."),
});

export const hiveSearchInput = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe("The task, error, or topic to search for."),
  repo: z
    .string()
    .optional()
    .describe("Boost results from this repository, such as owner/name. Other repositories can still match."),
  tags: z
    .array(z.string())
    .optional()
    .describe("Limit results to these topic tags."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(8)
    .describe("The maximum number of results, from 1 to 25."),
});

export const hiveAskInput = z.object({
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
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("The maximum number of recent learnings, from 1 to 50."),
});

export const hiveFeedbackInput = z.object({
  id: z.string().describe("The identifier of the learning to review."),
  vote: feedbackVoteSchema.describe(
    "Vote up for useful knowledge, down for unhelpful knowledge, or outdated for stale knowledge.",
  ),
  note: z
    .string()
    .max(1000)
    .optional()
    .describe(
      "Optional context for the vote or a correction, up to 1000 characters.",
    ),
});

export type HivePushInput = z.infer<typeof hivePushInput>;
export type HiveSearchInput = z.infer<typeof hiveSearchInput>;
export type HiveAskInput = z.infer<typeof hiveAskInput>;
export type HiveRecentInput = z.infer<typeof hiveRecentInput>;
export type HiveFeedbackInput = z.infer<typeof hiveFeedbackInput>;
