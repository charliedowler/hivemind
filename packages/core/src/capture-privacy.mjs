export const capturePrivacyMessage = "This observation may contain a secret or personal data. Remove identifying details before sharing it.";

const secretPatterns = [
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )*PRIVATE KEY-----|$)/g,
  /\b(?:sk-ant-|sk-)[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/g,
  /\bxox[bap]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\b(?:hm_|ha_)[A-Za-z0-9_-]{43}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];
const placeholder = /^(?:\[redacted\]|\[removed\]|<[^>]+>|\*+|\$\{[^}]+\}|process\.env\.[\w]+|(?:undefined|null|true|false))$/i;
const secretName = String.raw`\b(?:[\w.-]*[_-])?(?:password|passwd|pwd|secret|api[_ -]?key|token|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|client[_ -]?secret|session(?:[_ -]?(?:id|token|key))?|cookie)\b["']?\s*(?:[:=]\s*|(?:is|was)\s+)`;
const assignment = new RegExp(`(${secretName})(["\x60'])([^\\r\\n]*?)\\2|(${secretName})(\\[[^\\]\\r\\n]*\\]|\\$\\{[^}\\r\\n]*\\}|<[^>\\r\\n]*>|[^\\s,;"'\x60]+)`, "gi");

export function redactSecrets(value) {
  let text = value;
  let count = 0;
  const replace = value => {
    if (!value || placeholder.test(value)) return value;
    count++;
    return "[redacted]";
  };
  for (const pattern of secretPatterns) text = text.replace(pattern, replace);
  text = text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@]+)(@)/gi, (_, prefix, password, suffix) => `${prefix}${replace(password)}${suffix}`);
  text = text.replace(assignment, (_, quotedPrefix, quote, quoted, prefix, bare) => quotedPrefix ? `${quotedPrefix}${quote}${replace(quoted)}${quote}` : `${prefix}${replace(bare)}`);
  text = text.replace(/(\bBearer\s+)(\[[^\]\r\n]*\]|<[^>\r\n]*>|[^\s"'`,;]+)/gi, (_, prefix, token) => `${prefix}${replace(token)}`);
  text = text.replace(/(\b(?:set-cookie|cookie)\s*:\s*)([^\r\n]+)/gi, (_, prefix, cookie) => `${prefix}${replace(cookie)}`);
  return { text, count };
}

const personalPatterns = [
  ["email", /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}\b/i],
  ["phone", /\b(?:0\d{9,10}|[2-9]\d{9})\b|\+\d[\d ().-]{7,}\d\b|(?:^|[^\w])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?\d{3,4}[ .-]\d{3,4}|\d{3}[ .-]\d{3}[ .-]\d{4})(?!\w)|\b(?:phone|mobile|telephone)\s*(?:number\s*)?(?:is|[:=])?\s*\+?\d[\d ()+.-]{7,}\d\b/i],
  ["postal_address", /\b\d{1,6}\s+(?:[\p{L}\d.'-]+\s+){1,5}(?:street|road|avenue|lane|drive|boulevard|court|crescent|terrace|way|st\.?|rd\.?|ave\.?)(?=\s|[,.]|$)|\b(?:home|postal|mailing|residential)\s+address\s*(?:is|[:=])\s*\S+/iu],
  ["national_id", /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b|\b\d{3}-\d{2}-\d{4}\b|\b(?:national\s*(?:id|insurance)|ssn|social security|passport|tax\s*id)\s*(?:number\s*)?(?:is|[:=])?\s*[A-Z0-9][A-Z0-9 -]{5,20}\b/i],
  ["health", /\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2}(?:'s)?[ \t]+(?:(?:has|have|had|is|was|takes|needs|cannot|can't|avoids|follows|eats|prefers|suffers|lives)[ \t]+)[^.!?\n]{0,100}\b(?:medical|appointment|checkup|surgery|asthma|shellfish|lactose|intoleran\w*|diabet\w*|allerg\w*|pregnan\w*|cancer|depression|medication|therapy|vegan|vegetarian|keto|gluten|peanuts?|diet|nuts?|dairy)\b/i],
  ["health", /\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2}'s[ \t]+(?:health|medical|dietary|allergies|diagnosis|prescription)\b/i],
  ["home_family", /\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){0,2}[ \t]+(?:is[ \t]+(?:married|divorced)|has[ \t]+(?:\w+[ \t]+){0,2}(?:children|kids|a[ \t]+family)|owns[ \t]+(?:a[ \t]+)?home)\b|\b(?:[Mm]y|[Hh]is|[Hh]er|[Tt]heir|[A-Z][a-z]+(?:'s))\s+(?:wife|husband|partner|spouse|child(?:ren)?|daughter|son|mother|father|family|home address)\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\s+(?:lives|resides)\s+(?:at|with|in)\b/],
];
const customerPatterns = [
  ["customer_identifier", /\b(?:customer|client|tenant|account)[_ -]?(?:id|identifier|number|email|name)\b["']?\s*(?:[:=]|is)\s*["']?(?!\[redacted\]|\[removed\]|<)[\w@.-]+/i],
  ["customer_record", /\b(?:customer|client)\b[^\n]{0,160}\b(?:sent|said|reported)\b[^\n]{0,100}\b(?:private|confidential|record|data|invoice|contract|ticket)\b|\b(?:private|confidential)\s+(?:customer|client|account|tenant)\b|\b(?:customer|client)\s+(?:rows?|records?|data)\s*(?:[:=]|is|contains|includes)\s*\S+/i],
  ["customer_rows", /(?:^|\n)\s*(?:customer|client|tenant|account)[_ -]?(?:id|name)[^\n]*[,|\t][^\n]*\n\s*[^\n]+[,|\t][^\n]+/i],
];

function strings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function clean(value, record) {
  if (typeof value === "string") {
    const result = redactSecrets(value);
    record.count += result.count;
    if (result.count && !usefulFact(result.text)) record.secretOnly = true;
    return result.text;
  }
  if (Array.isArray(value)) return value.map(item => clean(item, record));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item, record)]));
  return value;
}

export function redactCaptureSecrets(input) {
  const record = {count: 0, secretOnly: false};
  return {input: clean(input, record), count: record.count};
}

function customerNames(options) {
  const names = [...(options.customerNames ?? [])];
  for (const rule of options.rules ?? []) {
    if (!rule.enabled || rule.action !== "drop") continue;
    if (rule.kind === "keyword" && !rule.regex && /\b(?:customer|client)\b/i.test(`${rule.name ?? ""} ${rule.naturalText ?? ""}`)) names.push(rule.pattern);
    for (const match of (rule.naturalText ?? "").matchAll(/\b(?:customer|client)(?:\s+(?:organisation|organization|company|names?))?\s*[:=]?\s*["'`]([^"'`\n]+)["'`]/gi)) names.push(match[1]);
  }
  return names.filter(name => typeof name === "string" && name.trim().length > 1);
}

function usefulFact(text) {
  const withoutSecrets = text.replace(/\[redacted\]/gi, "");
  return /\b(?:fix(?:es|ed)?|fail(?:s|ed)?|require[sd]?|avoid[sd]?|reject[sd]?|retr(?:y|ies|ied)|rotate[sd]?|validate[sd]?|configure[sd]?|load[sd]?|read[sd]?|parse[sd]?|escape[sd]?|connect[sd]?|use[sd]?|set[st]?|support[sd]?)\b\s+[\w"`]/i.test(withoutSecrets) && /\b(?:code|config\w*|env\w*|database|postgres(?:ql)?|mysql|redis|mongodb|connection|pool|request|parser|server|client|header|auth\w*|fixture|test|file|schema|build)\b/i.test(withoutSecrets);
}

export function gateCapturePrivacy(input, options = {}) {
  const record = { count: 0, secretOnly: false };
  const sanitized = clean(input, record);
  const text = strings(sanitized).filter(value => !/^(?:git@[^\s:]+:[^\s]+|ssh:\/\/git@[^\s]+)$/.test(value)).join("\n");
  const refuse = (category, reason) => ({ action: "refuse", category, reason, message: capturePrivacyMessage, redactionCount: record.count });
  for (const [reason, pattern] of personalPatterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      if (reason === "health" && /^(?:(?:the|a|our)\s+)?(?:code|schema|parser|api|server|client|field|type|test|fixture|database|app|application|service)\b/i.test(match[0])) continue;
      return refuse("personal_info", reason);
    }
  }
  for (const match of text.matchAll(/(?<![\w])(?:\d[ -]?){13,19}(?![\w])/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19) return refuse("personal_info", "card_number");
  }
  const lower = text.toLowerCase();
  if (customerNames(options).some(name => {
    const needle = name.trim().toLowerCase();
    let position = lower.indexOf(needle);
    while (position !== -1) {
      if (!/[\p{L}\p{N}_]/u.test(lower[position - 1] ?? "") && !/[\p{L}\p{N}_]/u.test(lower[position + needle.length] ?? "")) return true;
      position = lower.indexOf(needle, position + 1);
    }
    return false;
  })) return refuse("customer_data", "customer_name");
  for (const [reason, pattern] of customerPatterns) if (pattern.test(text)) return refuse("customer_data", reason);
  if (record.secretOnly) return refuse("credentials", "secret_only");
  return { action: record.count ? "redact" : "allow", input: sanitized, redactionCount: record.count };
}
