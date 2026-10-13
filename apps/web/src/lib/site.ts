// Deployment identity for public pages. Set these per deployment; see docs/self-hosting.md.
const fallbackUrl = "https://gohive.dev";

export function siteUrl(): URL {
  return URL.parse(process.env.PUBLIC_URL?.trim() ?? "") ?? new URL(fallbackUrl);
}

export function siteHost(): string {
  return siteUrl().host;
}

// Legal name shown on the legal pages and footers, for example "Example Ltd".
export function operatorName(): string | undefined {
  return process.env.OPERATOR_NAME?.trim() || undefined;
}

// Address for privacy and terms questions.
export function operatorEmail(): string | undefined {
  return process.env.OPERATOR_EMAIL?.trim() || undefined;
}

export function brandLine(): string {
  const name = operatorName();
  return name ? `Hive by ${name}` : "Hive";
}
