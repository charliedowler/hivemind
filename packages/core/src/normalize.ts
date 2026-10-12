export function normalizeRepo(repo?: string | null): string | null {
  const value = repo?.trim().replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
  return value || null;
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter(Boolean))];
}

export function parseSince(since: string, now: Date = new Date()): Date {
  const relative = /^([1-9]\d*)(m|h|d|w)$/.exec(since);
  if (relative) {
    const units: Record<string, number> = { m: 60000, h: 3600000, d: 86400000, w: 604800000 };
    const date = new Date(now.getTime() - Number(relative[1]) * units[relative[2]]);
    if (Number.isFinite(date.getTime())) return date;
  }
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(since)) {
    const date = new Date(since);
    if (Number.isFinite(date.getTime())) return date;
  }
  throw new Error("Since must be an ISO datetime or a positive duration such as 24h or 7d.");
}
