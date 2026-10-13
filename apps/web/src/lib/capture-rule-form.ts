import { captureRuleInputSchema } from "@hivemind/core";

export function parseCaptureRuleForm(form: FormData) {
  const values = Object.fromEntries(form);
  return captureRuleInputSchema.safeParse({
    ...values,
    owners: String(values.owners ?? "")
      .split(",")
      .map((owner) => owner.trim())
      .filter(Boolean),
    sessionType: String(values.sessionType ?? "").trim() || undefined,
    enabled: form.has("enabled"),
    regex: form.has("regex"),
    caseSensitive: form.has("caseSensitive"),
  });
}
