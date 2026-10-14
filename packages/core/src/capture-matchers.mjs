export const capturePatternLimit = 256;
export const captureInputLimit = 20000;
function parseRegex(pattern, caseSensitive) {
    if (!pattern || pattern.length > capturePatternLimit)
        return null;
    const tokens = [];
    const start = pattern.startsWith("^");
    let end = false;
    let index = start ? 1 : 0;
    while (index < pattern.length) {
        if (pattern[index] === "$" && index === pattern.length - 1) {
            end = true;
            index++;
            break;
        }
        const beginning = index;
        const character = pattern[index++];
        if (character === "\\") {
            const escaped = pattern[index++];
            if (!escaped || (/[a-zA-Z0-9]/.test(escaped) && !/[dDsSwWnrt]/.test(escaped)))
                return null;
        }
        else if (character === "[") {
            let closed = false;
            while (index < pattern.length) {
                const next = pattern[index++];
                if (next === "\\") {
                    const escaped = pattern[index++];
                    if (!escaped || (/[a-zA-Z0-9]/.test(escaped) && !/[dDsSwWnrt]/.test(escaped)))
                        return null;
                }
                else if (next === "]") {
                    closed = true;
                    break;
                }
            }
            if (!closed)
                return null;
        }
        else if (/[()|^$*+?{}\]]/.test(character)) {
            return null;
        }
        let matcher;
        try {
            matcher = new RegExp(`^(?:${pattern.slice(beginning, index)})$`, caseSensitive ? "" : "i");
        }
        catch {
            return null;
        }
        let min = 1;
        let max = 1;
        const quantifier = pattern[index];
        if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
            index++;
            min = quantifier === "+" ? 1 : 0;
            max = quantifier === "?" ? 1 : Infinity;
        }
        else if (quantifier === "{") {
            const repeat = /^\{(\d{1,2})(?:,(\d{1,2}))?\}/.exec(pattern.slice(index));
            if (!repeat)
                return null;
            min = Number(repeat[1]);
            max = Number(repeat[2] ?? repeat[1]);
            if (max < min || max > 64)
                return null;
            index += repeat[0].length;
        }
        if (min !== max && tokens.at(-1)?.min !== tokens.at(-1)?.max)
            return null;
        tokens.push({ test: (value) => matcher.test(value), min, max });
    }
    if (!tokens.length || tokens.every((token) => token.min === 0))
        return null;
    return { tokens, start, end };
}
function regexSpans(parsed, text) {
    const length = text.length;
    let suffix = Array.from({ length: length + 1 }, (_, index) => !parsed.end || index === length ? index : -1);
    for (const token of [...parsed.tokens].reverse()) {
        const current = new Array(length + 1).fill(-1);
        const queue = [];
        let head = 0;
        let run = 0;
        for (let index = length; index >= 0; index--) {
            run = index < length && token.test(text[index]) ? run + 1 : 0;
            const lower = index + token.min;
            const upper = index + Math.min(token.max, run);
            if (lower <= length) {
                while (queue.length > head && suffix[queue[queue.length - 1]] <= suffix[lower])
                    queue.pop();
                queue.push(lower);
            }
            while (queue.length > head && queue[head] > upper)
                head++;
            if (lower <= upper && queue.length > head)
                current[index] = suffix[queue[head]];
        }
        suffix = current;
    }
    const spans = [];
    for (let index = 0; index < length; index++) {
        if (parsed.start && index !== 0)
            break;
        if (suffix[index] > index) {
            spans.push({ start: index, end: suffix[index] });
            index = suffix[index] - 1;
        }
    }
    return spans;
}
function keywordSpans(rule, text) {
    if (text.length > captureInputLimit)
        throw new RangeError("Capture text exceeds the 20000 character matching limit.");
    if (rule.regex) {
        const parsed = parseRegex(rule.pattern, rule.caseSensitive);
        if (!parsed)
            throw new Error("Invalid capture regex.");
        return regexSpans(parsed, text);
    }
    const escaped = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Array.from(text.matchAll(new RegExp(escaped, rule.caseSensitive ? "g" : "gi")), (match) => ({ start: match.index, end: match.index + match[0].length }));
}
function globMatches(pattern, value) {
    if (value.length > captureInputLimit)
        throw new RangeError("Capture path exceeds the 20000 character matching limit.");
    const normalized = pattern.replace(/\\/g, "/");
    const tokens = [];
    for (let index = 0; index < normalized.length; index++) {
        const character = normalized[index];
        if (character === "*" && normalized[index + 1] === "*") {
            while (normalized[index + 1] === "*")
                index++;
            if (normalized[index + 1] === "/") {
                index++;
                tokens.push({ kind: "directory" });
            }
            else
                tokens.push({ kind: "globstar" });
        }
        else if (character === "*")
            tokens.push({ kind: "star" });
        else if (character === "?")
            tokens.push({ kind: "one" });
        else
            tokens.push({ kind: "literal", value: character });
    }
    const text = value.replace(/\\/g, "/");
    let suffix = new Array(text.length + 1).fill(false);
    suffix[text.length] = true;
    for (const token of tokens.reverse()) {
        const current = new Array(text.length + 1).fill(false);
        let directory = false;
        for (let index = text.length; index >= 0; index--) {
            const exists = index < text.length;
            if (token.kind === "directory") {
                directory = directory || (exists && text[index] === "/" && suffix[index + 1]);
                current[index] = suffix[index] || directory;
            }
            else if (token.kind === "star" || token.kind === "globstar") {
                current[index] = suffix[index] || (exists && (token.kind === "globstar" || text[index] !== "/") && current[index + 1]);
            }
            else
                current[index] = exists && suffix[index + 1] && (token.kind === "one" ? text[index] !== "/" : text[index] === token.value);
        }
        suffix = current;
    }
    return suffix[0];
}
function repoIdentity(value) {
    if (!value?.trim())
        return null;
    let path = value.trim();
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
        try {
            path = new URL(path).pathname;
        }
        catch {
            return null;
        }
    }
    else if (/^[^/\s]+@[^/\s]+:/.test(path))
        path = path.slice(path.indexOf(":") + 1);
    path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (path.split("/").length >= 3 && path.split("/")[0].includes(".")) path = path.split("/").slice(1).join("/");
    return /^[^/\s]+\/[^/\s]+$/.test(path) ? path.toLowerCase() : null;
}
function absoluteHome(value) {
    if (!value || value.length > captureInputLimit)
        return null;
    const path = value.replace(/\\/g, "/").replace(/\/+$/g, "");
    return path.startsWith("/") && !path.startsWith("//") && !path.split("/").some((part) => part === "." || part === "..") ? path : null;
}
function derivedHome(value) {
    const path = absoluteHome(value);
    return path?.match(/^(\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/)?.[0] ?? null;
}
function pathMatches(pattern, path, input) {
    if (path.length > captureInputLimit)
        throw new RangeError("Capture path exceeds the 20000 character matching limit.");
    if (!pattern.startsWith("~/") || path.startsWith("~/"))
        return globMatches(pattern, path);
    const home = input.home != null ? absoluteHome(input.home) : derivedHome(input.cwd) ?? derivedHome(path);
    const normalizedPath = path.replace(/\\/g, "/");
    return home !== null && normalizedPath.startsWith(home + "/") && globMatches(pattern.slice(2), normalizedPath.slice(home.length + 1));
}
function mask(text, spans) {
    const merged = [];
    for (const span of spans.sort((a, b) => a.start - b.start || a.end - b.end)) {
        const previous = merged.at(-1);
        if (previous && span.start < previous.end)
            previous.end = Math.max(previous.end, span.end);
        else
            merged.push({ ...span });
    }
    let result = "";
    let cursor = 0;
    for (const span of merged) {
        result += text.slice(cursor, span.start) + "[removed]";
        cursor = span.end;
    }
    return result + text.slice(cursor);
}
export function evaluateCaptureRules(rules, input) {
    const result = { action: "allow", title: input.title, body: input.body, redacted: false, flagged: false, matches: [], neededCategories: [] };
    const titleSpans = [];
    const bodySpans = [];
    let wholeText = false;
    const active = rules.filter((rule) => rule.enabled);
    const repo = repoIdentity(input.repo) ?? repoIdentity(input.remote);
    const record = (rule, title = [], body = []) => {
        result.matches.push({ ruleId: rule.id, kind: rule.kind, action: rule.action });
        if (rule.action === "drop")
            result.action = "drop";
        else if (rule.action === "flag")
            result.flagged = true;
        else {
            result.redacted = true;
            if (rule.kind !== "keyword")
                wholeText = true;
            titleSpans.push(...title);
            bodySpans.push(...body);
        }
    };
    for (const rule of active) {
        switch (rule.kind) {
            case "content_category": break;
            case "repo_owner": {
                const owners = rule.owners ?? (rule.owner ? [rule.owner] : []);
                const matches = owners.some((owner) => repo?.split("/")[0] === owner.toLowerCase());
                if (rule.mode === "deny" ? matches : !matches)
                    record(rule);
                break;
            }
            case "repo_match": {
                const project = projectFromContext(input);
                const matches = Boolean((repo && globMatches(rule.pattern.toLowerCase(), repo)) || (input.remote && globMatches(rule.pattern, input.remote)) || (canonicalProject(rule.pattern, true) === rule.pattern && projectPatternMatches(rule.pattern, project)));
                if (rule.mode === "only_allow" ? !matches : matches) record(rule);
                break;
            }
            case "path_match":
                if ([input.cwd, ...(input.paths ?? [])].some((path) => path && pathMatches(rule.pattern, path, input)))
                    record(rule);
                break;
            case "agent_or_client":
                if ((rule.agent || rule.sessionType) && (!rule.agent || input.agent?.toLowerCase() === rule.agent.toLowerCase()) && (!rule.sessionType || input.sessionType?.toLowerCase() === rule.sessionType.toLowerCase()))
                    record(rule);
                break;
            case "keyword": {
                const title = keywordSpans(rule, input.title);
                const body = keywordSpans(rule, input.body);
                if (title.length || body.length)
                    record(rule, title, body);
                break;
            }
        }
    }
    if (result.action !== "drop") {
        for (const rule of active) {
            if (rule.kind !== "content_category")
                continue;
            if (input.categories?.[rule.category] === true)
                record(rule);
            else if (input.categories?.[rule.category] !== false)
                result.neededCategories.push(rule.category);
        }
        result.neededCategories = result.matches.some((match) => match.action === "drop") ? [] : [...new Set(result.neededCategories)];
    }
    result.title = wholeText ? "[removed]" : mask(input.title, titleSpans);
    result.body = wholeText ? "[removed]" : mask(input.body, bodySpans);
    if (result.action !== "drop")
        result.action = result.redacted ? "redact" : result.flagged ? "flag" : "allow";
    return result;
}
export function isSafeCaptureRegex(pattern, caseSensitive = false) { return parseRegex(pattern, caseSensitive) !== null; }

export function canonicalProject(value, pattern = false) {
    if (typeof value !== "string" || !value.trim() || value.length > 1000) return null;
    let host = "github.com";
    let path = value.trim();
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
        try {
            const url = new URL(path);
            if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol) || url.port) return null;
            host = url.hostname.toLowerCase();
            path = url.pathname;
        } catch { return null; }
    } else {
        const scp = /^(?:[^@/\s]+@)?([a-z\d.-]+):([^\s]+)$/i.exec(path);
        if (scp) { host = scp[1].toLowerCase(); path = scp[2]; }
        else {
            const pieces = path.split("/");
            if (pieces.length >= 3 && pieces[0].includes(".")) { host = pieces.shift().toLowerCase(); path = pieces.join("/"); }
        }
    }
    path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (host === "github.com") path = path.toLowerCase();
    const segments = path.split("/");
    const allowed = pattern ? /^[a-z\d_.?*-]+$/i : /^[a-z\d_.-]+$/i;
    if (!/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host) || host.includes("..") || segments.length < 2 || segments.some(s => !allowed.test(s) || s === "." || s === ".." || s.includes("**"))) return null;
    const result = `${host}/${path}`;
    return result.length <= 256 ? result : null;
}
export function projectFromContext(input) {
    const repo = input.repo == null ? null : canonicalProject(input.repo);
    const remote = input.remote == null ? null : canonicalProject(input.remote);
    if ((input.repo != null && !repo) || (input.remote != null && !remote)) return null;
    if (repo && remote) {
        const rawRepo = input.repo.trim();
        const explicitHost = /^[a-z][a-z\d+.-]*:\/\//i.test(rawRepo) || rawRepo.split("/")[0].includes(".") || rawRepo.includes("@");
        const resolvedRepo = explicitHost ? repo : canonicalProject(`${remote.split("/")[0]}/${input.repo}`);
        if (resolvedRepo !== remote) return null;
    }
    return remote ?? repo;
}
export function projectPatternMatches(pattern, project) {
    const canonical = canonicalProject(pattern, true);
    return Boolean(canonical && project && globMatches(canonical, project));
}
function samePath(left, right) {
    const clean = value => String(value).trim().replace(/[\\/]+$/, "");
    return clean(left) !== "" && clean(left) === clean(right);
}
export function evaluateProjectPolicy(policy, input) {
    const project = projectFromContext(input);
    const mode = policy?.mode === "everything" ? "everything" : "selected";
    if (!policy || !Array.isArray(policy.include) || !Array.isArray(policy.exclude) || (mode === "selected" && !policy.include.length)) return {allowed: false, project, reason: "no_selection"};
    if (policy.include.length > 100 || policy.exclude.length > 100 || [...policy.include, ...policy.exclude].some(pattern => !canonicalProject(pattern, true))) return {allowed: false, project, reason: "invalid_policy"};
    if (input.cwd != null && input.home != null && samePath(input.cwd, input.home)) return {allowed: false, project, reason: "home_directory"};
    if (!project) return {allowed: false, project: null, reason: "unknown_project"};
    if (policy.exclude.some(pattern => projectPatternMatches(pattern, project))) return {allowed: false, project, reason: "excluded_project"};
    if (mode === "everything") return {allowed: true, project, reason: "captured"};
    const allowed = policy.include.some(pattern => projectPatternMatches(pattern, project));
    return {allowed, project, reason: allowed ? "selected" : "unselected_project"};
}
