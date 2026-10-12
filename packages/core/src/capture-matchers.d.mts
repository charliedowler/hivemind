import type { CaptureEvaluation, CaptureEvaluationInput, CaptureRule } from "./capture-rules";

export const capturePatternLimit: 256;
export const captureInputLimit: 20000;
export function isSafeCaptureRegex(pattern: string, caseSensitive?: boolean): boolean;
export function evaluateCaptureRules(rules: readonly CaptureRule[], input: CaptureEvaluationInput): CaptureEvaluation;
