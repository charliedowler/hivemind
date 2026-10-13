import { isCompanyDomain } from "company-email-validator";
export function emailDomain(email: string): string | null {
  const parts = email.split("@");
  const value = parts.length === 2 ? parts[1].trim().toLowerCase() : "";
  return value.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      value,
    )
    ? value
    : null;
}
export function isPublicDomain(domain: string): boolean {
  if (!emailDomain(`member@${domain}`)) return true;
  const labels = domain.split(".");
  return labels.some(
    (_, i) =>
      i < labels.length - 1 &&
      (!isCompanyDomain(labels.slice(i).join(".")) ||
        ["google.com", "microsoft.com", "onmicrosoft.com", "sfr.fr", "agentmail.to", "agentmail.cc"].includes(
          labels.slice(i).join("."),
        )),
  );
}

export function canJoinByDomain(email: string, actorType: string): boolean {
  const domain = emailDomain(email);
  return actorType !== "agent" && Boolean(domain && !isPublicDomain(domain));
}
