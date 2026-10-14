import { z } from "zod";
import { canonicalProject } from "./capture-matchers.mjs";

export const captureModes = ["everything", "selected"] as const;
export type CaptureMode = (typeof captureModes)[number];
export const workAreasLimit = 300;
export const projectPatterns = z.array(z.string().trim().min(1).max(1000).transform(value => canonicalProject(value, true)).refine(value => value !== null, "Use host/namespace/repo with optional * or ?.")).max(100).transform(values => [...new Set(values as string[])].sort());
export const hiveShareProjectsInput = z.strictObject({
  mode: z.enum(captureModes).optional().describe("everything captures from every Git repository with a remote except exclude; selected captures only from include."),
  include: projectPatterns.optional(),
  exclude: projectPatterns.optional(),
  workAreas: z.string().trim().max(workAreasLimit).optional().describe("The person's own words for what they work on, e.g. \"frontend React, dbt models, infra\". Tags captures and suggests what to share; it never limits capture."),
  revision: z.number().int().nonnegative(),
  humanInstruction: z.string().trim().min(1).max(4000).optional(),
});
export type HiveShareProjectsInput = z.input<typeof hiveShareProjectsInput>;
export type OwnerCapturePolicy = {mode: CaptureMode; include: string[]; exclude: string[]; workAreas: string; revision: number};
export const hiveJoinInput = z.strictObject({phrase: z.string().trim().min(1).max(80)});

const areaStopWords = new Set(["and", "the", "for", "with", "our", "work", "working", "stuff", "things", "some", "other", "etc"]);
export function parseWorkAreas(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.split(/[,;\n]+|\s+(?:and|&)\s+/i).map(area => area.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "")).filter(area => area.length >= 2 && area.length <= 60))].slice(0, 12);
}
const areaWords = (area: string) => (area.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? []).map(word => word.replace(/[.-]+$/, "")).filter(word => word.length >= 2 && !areaStopWords.has(word));
export function matchWorkAreas(text: string | null | undefined, content: string): string[] {
  const haystack = new Set(content.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu)?.map(word => word.replace(/[.-]+$/, "")) ?? []);
  return parseWorkAreas(text).filter(area => areaWords(area).some(word => haystack.has(word) || (word.length >= 4 && [...haystack].some(token => token.startsWith(word)))));
}
export function describeWorkAreas(text: string | null | undefined): string {
  const areas = parseWorkAreas(text);
  if (areas.length <= 1) return areas[0] ?? "";
  return `${areas.slice(0, -1).join(", ")} and ${areas.at(-1)}`;
}
