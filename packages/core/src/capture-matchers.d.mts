import type { CaptureEvaluation, CaptureEvaluationInput, CaptureRule } from "./capture-rules";

export const capturePatternLimit: 256;
export const captureInputLimit: 20000;
export function isSafeCaptureRegex(pattern: string, caseSensitive?: boolean): boolean;
export function evaluateCaptureRules(rules: readonly CaptureRule[], input: CaptureEvaluationInput): CaptureEvaluation;

export type ProjectPolicy = {mode?: "everything" | "selected"; include: string[]; exclude: string[]; revision: number};
export function canonicalProject(value: string, pattern?: boolean): string | null;
export function projectFromContext(input: {repo?: string | null; remote?: string | null}): string | null;
export function projectPatternMatches(pattern: string, project: string | null): boolean;
export type ProjectPolicyReason = "no_selection" | "invalid_policy" | "home_directory" | "unknown_project" | "excluded_project" | "unselected_project" | "captured" | "selected";
export function evaluateProjectPolicy(policy: ProjectPolicy | null | undefined, input: {repo?: string | null; remote?: string | null; cwd?: string | null; home?: string | null}): {allowed: boolean; project: string | null; reason: ProjectPolicyReason};
