export const captureDefaults = [
  { category: "credentials", label: "Credentials", detail: "Passwords, access tokens and secret keys" },
  { category: "personal_info", label: "Personal data", detail: "Private contact, health and financial details" },
  { category: "customer_data", label: "Customer data", detail: "Customer identities and private communications" },
] as const;

export function defaultCaptureRuleId(teamId: string, category: string) {
  return `crule_default_${category}_${teamId}`;
}
