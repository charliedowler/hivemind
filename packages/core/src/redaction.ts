const patterns = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
  /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/g,
  /\bxox[bap]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bhm_[A-Za-z0-9_-]{43}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  for (const pattern of patterns) {
    text = text.replace(pattern, () => { count += 1; return "[redacted]"; });
  }
  text = text.replace(/(postgres(?:ql)?:\/\/[^\s:/@]+:)([^\s@]+)(@)/gi, (_, prefix: string, password: string, suffix: string) => {
    if (password === "[redacted]") return `${prefix}${password}${suffix}`;
    count += 1;
    return `${prefix}[redacted]${suffix}`;
  });
  return { text, count };
}
