import { z } from "zod";

export const captureCategories = [
  "personal_info",
  "credentials",
  "customer_data",
  "non_work",
] as const;
export type CaptureCategory = (typeof captureCategories)[number];
export { evaluateCaptureRules, capturePatternLimit, captureInputLimit } from "./capture-matchers.mjs";
import { capturePatternLimit, isSafeCaptureRegex } from "./capture-matchers.mjs";

const common = {
  name: z.string().trim().min(1).max(120),
  scope: z.enum(["member", "team"]).default("member"),
  action: z.enum(["drop", "redact", "flag"]),
  enabled: z.boolean().default(true),
  source: z.enum(["web", "slack", "mcp"]).default("web"),
  naturalText: z.string().trim().max(4000).nullable().optional(),
};
const globPattern = z.string().min(1).max(capturePatternLimit).refine(
  (pattern) => !/[\x00-\x1f\[\]{}()]/.test(pattern),
  "Use literals, *, ** or ? in a glob.",
);

export const captureRuleInputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("repo_owner"),
    owners: z.array(z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/)).min(1).max(100).default([]),
    owner: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
    mode: z.enum(["only_allow", "deny"]),
  }).refine((rule) => !!rule.owners?.length || !!rule.owner, { path: ["owners"], message: "Enter at least one repo owner." }).overwrite((rule) => ({ ...rule, owners: [...new Set((rule.owners.length ? rule.owners : rule.owner ? [rule.owner] : []).map((owner) => owner.toLowerCase()))] })),
  z.object({ ...common, kind: z.literal("repo_match"), pattern: globPattern }),
  z.object({ ...common, kind: z.literal("path_match"), pattern: globPattern }),
  z.object({
    ...common,
    kind: z.literal("content_category"),
    category: z.enum(captureCategories),
  }),
  z.object({
    ...common,
    kind: z.literal("agent_or_client"),
    agent: z.string().trim().min(1).max(120).optional(),
    sessionType: z.string().trim().min(1).max(120).optional(),
  }).refine((rule) => !!rule.agent || !!rule.sessionType, {
    path: ["agent"],
    message: "Enter an agent or session type.",
  }),
  z.object({
    ...common,
    kind: z.literal("keyword"),
    pattern: z.string().min(1).max(capturePatternLimit),
    regex: z.boolean().default(false),
    caseSensitive: z.boolean().default(false),
  }).refine((rule) => !rule.regex || isSafeCaptureRegex(rule.pattern, rule.caseSensitive), {
    message: "Use a bounded regex without groups, alternatives, backreferences or adjacent repetitions.",
    path: ["pattern"],
  }),
]);
export type CaptureRuleInput = z.infer<typeof captureRuleInputSchema>;
export type CaptureRule = CaptureRuleInput & {
  id: string;
  teamId: string;
  memberId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type CaptureEvaluationInput = {
  title: string;
  body: string;
  repo?: string | null;
  remote?: string | null;
  cwd?: string | null;
  home?: string | null;
  paths?: string[] | null;
  agent?: string | null;
  sessionType?: string | null;
  categories?: Record<string, boolean> | null;
};
export type CaptureEvaluation = {
  action: "allow" | "drop" | "redact" | "flag";
  title: string;
  body: string;
  redacted: boolean;
  flagged: boolean;
  matches: { ruleId: string; kind: CaptureRuleInput["kind"]; action: CaptureRuleInput["action"] }[];
  neededCategories: CaptureCategory[];
};
