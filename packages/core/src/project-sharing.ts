import { z } from "zod";
import { canonicalProject } from "./capture-matchers.mjs";

export const projectPatterns = z.array(z.string().trim().min(1).max(1000).transform(value => canonicalProject(value, true)).refine(value => value !== null, "Use host/namespace/repo with optional * or ?.")).max(100).transform(values => [...new Set(values as string[])].sort());
export const hiveShareProjectsInput = z.strictObject({
  include: projectPatterns.optional(),
  exclude: projectPatterns.optional(),
  revision: z.number().int().nonnegative(),
  humanInstruction: z.string().trim().min(1).max(4000).optional(),
});
export type HiveShareProjectsInput = z.input<typeof hiveShareProjectsInput>;
export type OwnerCapturePolicy = {include: string[]; exclude: string[]; revision: number};
export const hiveJoinInput = z.strictObject({phrase: z.string().trim().min(1).max(80)});
