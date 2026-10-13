import type { CaptureRule } from "./capture-rules";

export const capturePrivacyMessage: string;
export function redactSecrets(text: string): { text: string; count: number };
export function redactCaptureSecrets<T>(input: T): {input: T; count: number};
export type PrivacyCategory = "credentials" | "personal_info" | "customer_data";
export type PrivacyReason = "email" | "phone" | "postal_address" | "national_id" | "health" | "home_family" | "card_number" | "customer_name" | "customer_identifier" | "customer_record" | "customer_rows" | "secret_only";
export type CapturePrivacyOptions = { rules?: CaptureRule[]; customerNames?: string[] };
export type CapturePrivacyResult<T> =
  | { action: "refuse"; category: PrivacyCategory; reason: PrivacyReason; message: string; redactionCount: number }
  | { action: "allow" | "redact"; input: T; redactionCount: number };
export function gateCapturePrivacy<T>(input: T, options?: CapturePrivacyOptions): CapturePrivacyResult<T>;
