import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import type { HiveContext } from "@hivemind/core";

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullable().default(null);
const count = z.number().int().nonnegative();
const probability = z.number().finite().min(0).max(1);
export const eventNames = [
  "access.changed",
  "learning.pushed",
  "learning.superseded",
  "learning.lifecycle_changed",
  "learning.feedback",
  "learning.viewed",
  "search.performed",
  "ask.performed",
  "recent.performed",
  "classifier.started",
  "classifier.completed",
  "model.started",
  "model.completed",
  "hook.fired",
  "install.step",
  "tree.rebuilt",
  "tree.read",
  "snapshot.exported",
  "slack.event_received",
  "slack.reply_decided",
  "page.viewed",
  "operation.started",
  "operation.finished",
] as const;
export const outcomes = [
  "completed",
  "failed",
  "refused",
  "skipped",
  "fallback",
  "unconfigured",
  "started",
  "signup",
  "login",
  "login_failed",
  "logout",
  "email_verification_sent",
  "email_verified",
  "invite_created",
  "invite_rotated",
  "invite_accepted",
  "domain_join",
  "key_created",
  "key_revoked",
  "member_removed",
  "role_changed",
  "mcp_oauth_authorized",
  "answer",
  "gap",
  "capture",
  "skip",
  "received",
  "reply",
  "silent",
] as const;
export const reasonCodes = [
  "sensitive_refused",
  "provider_failed",
  "invalid_response",
  "provider_refused",
  "max_tokens",
  "not_configured",
  "no_results",
  "weak_evidence",
  "invalid_credentials",
  "local_gate",
  "revision_conflict",
  "request_failed",
  "invalid_input",
  "not_found",
  "access_denied",
  "rate_limited",
  "manual",
  "feedback",
  "duplicate",
  "replacement",
  "friction_summary",
  "fallback_gate",
  "installer_failed",
  "doctor_failed",
  "storage_failed",
] as const;
const modelSchema = z.enum([
  "jev-1.13.0",
  "text-embedding-3-small",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
]);
export function reportedModel(value: unknown) {
  const result = modelSchema.safeParse(value);
  return result.success ? result.data : null;
}
export const propertiesSchema = z.object({
  actorKind: nullable(z.enum(["member", "anonymous", "system"])),
  role: nullable(z.enum(["admin", "member"])),
  earlyAccessId: nullable(z.string().regex(/^ea_[a-z2-7]{12}$/)),
  keyId: nullable(z.string().regex(/^key_[a-z2-7]{12}$/)),
  targetMemberId: nullable(z.string().regex(/^mem_[a-z2-7]{12}$/)),
  kind: nullable(
    z.enum([
      "learning",
      "gotcha",
      "decision",
      "snippet",
      "incident",
      "insight",
      "friction",
    ]),
  ),
  source: nullable(
    z.enum(["claude-code", "codex", "slack", "web", "hook", "unknown"]),
  ),
  merged: nullable(z.boolean()),
  sensitiveRefused: nullable(z.boolean()),
  worthSharingProbability: nullable(probability),
  sensitiveProbability: nullable(probability),
  kindProbability: nullable(probability),
  kindProbabilities: nullable(
    z.record(
      z.enum([
        "learning",
        "gotcha",
        "decision",
        "snippet",
        "incident",
        "insight",
        "friction",
      ]),
      probability,
    ),
  ),
  repoAreaProbability: nullable(probability),
  severity: nullable(z.number().finite().min(0).max(4)),
  relevanceProbability: nullable(probability),
  gateDecision: nullable(
    z.enum(["answer", "gap", "capture", "skip", "reply", "silent"]),
  ),
  vote: nullable(z.enum(["up", "down", "outdated"])),
  previousState: nullable(
    z.enum(["fresh", "confirmed", "superseded", "outdated", "retracted"]),
  ),
  state: nullable(
    z.enum(["fresh", "confirmed", "superseded", "outdated", "retracted"]),
  ),
  newerLearningId: nullable(z.string().regex(/^lrn_[a-z2-7]{12}$/)),
  resultCount: nullable(count),
  retrievedCount: nullable(count),
  citedCount: nullable(count),
  topScoreBand: nullable(z.enum(["none", "low", "medium", "high"])),
  vectorUsed: nullable(z.boolean()),
  textUsed: nullable(z.boolean()),
  prefixUsed: nullable(z.boolean()),
  recencyUsed: nullable(z.boolean()),
  votesUsed: nullable(z.boolean()),
  repoBoostUsed: nullable(z.boolean()),
  gapReported: nullable(z.boolean()),
  synthesized: nullable(z.boolean()),
  purpose: nullable(
    z.enum([
      "push",
      "hook",
      "ask",
      "embedding",
      "synthesis",
      "tags",
      "relations",
      "rerank",
    ]),
  ),
  model: nullable(modelSchema),
  requestedModel: nullable(modelSchema),
  inputTokens: nullable(count),
  outputTokens: nullable(count),
  cacheReadTokens: nullable(count),
  cacheWriteTokens: nullable(count),
  callId: nullable(z.string().uuid()),
  operation: nullable(
    z.enum([
      "push",
      "search",
      "ask",
      "recent",
      "feedback",
      "tree_read",
      "tree_browse",
      "snapshot",
      "tree_rebuild",
    ]),
  ),
  operationId: nullable(z.string().uuid()),
  hookKind: nullable(z.enum(["session_start", "stop"])),
  pushedCount: nullable(count),
  step: nullable(
    z.enum([
      "started",
      "mcp_configured",
      "instructions_written",
      "hook_configured",
      "completed",
      "doctor",
    ]),
  ),
  agent: nullable(z.enum(["claude-code", "codex"])),
  platform: nullable(z.enum(["darwin", "linux", "win32", "unknown"])),
  page: nullable(z.enum(["landing", "waitlist", "install"])),
  area: nullable(
    z.enum(["repo", "tool", "process", "docs", "environment", "people"]),
  ),
  frictionMinutes: nullable(count),
  blocked: nullable(z.boolean()),
  revision: nullable(count),
  files: nullable(count),
  bytes: nullable(count),
  slackEventKind: nullable(
    z.enum(["mention", "message", "reaction", "action", "command", "other"]),
  ),
});
export type Properties = z.input<typeof propertiesSchema>;
export type EntryPoint =
  "mcp" | "web" | "slack" | "hook" | "installer" | "scheduled" | "unknown";
export type Origin = {
  teamId: string | null;
  memberId: string | null;
  apiKeyId: string | null;
  sessionKind: "api_key" | "web_session" | "oauth" | "anonymous" | "system";
  requestId: string;
  entrypoint: EntryPoint;
  environment: "production" | "preview" | "development" | "test" | "unknown";
  isTest: boolean | null;
  testBasis: "unit_test" | "simulation" | "deployment" | "unclassified";
};
export type EventInput = {
  name: (typeof eventNames)[number];
  key?: string;
  outcome?: (typeof outcomes)[number];
  reasonCode?: (typeof reasonCodes)[number] | null;
  latencyMs?: number | null;
  learningId?: string | null;
  properties?: Properties;
  origin?: Origin;
  occurredAt?: Date;
};
export type EventRow = ReturnType<typeof eventRow>;
export type EventWriter = (row: EventRow, signal: AbortSignal) => Promise<void>;
type State = {
  origin: Origin;
  writer: EventWriter;
  budget: { remaining: number };
  mutations?: EventInput[];
};
const context = new AsyncLocalStorage<State>();
const roles = new WeakMap<HiveContext, "admin" | "member">();
export const bindRole = (ctx: HiveContext, role: "admin" | "member") => {
  roles.set(ctx, role);
  return ctx;
};
const keyIds = new WeakMap<HiveContext, string>();
export const bindApiKey = (ctx: HiveContext, id: string) => {
  keyIds.set(ctx, id);
  return ctx;
};
export const apiKeyId = (ctx: HiveContext) => keyIds.get(ctx) ?? null;
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function originFor(
  ctx?: HiveContext,
  entrypoint: EntryPoint = "web",
  sessionKind?: Origin["sessionKind"],
): Origin {
  const environment =
    process.env.NODE_ENV === "test"
      ? "test"
      : process.env.VERCEL_ENV === "production"
        ? "production"
        : process.env.VERCEL_ENV === "preview"
          ? "preview"
          : process.env.NODE_ENV === "development"
            ? "development"
            : "unknown";
  const traffic = process.env.HIVE_ANALYTICS_TRAFFIC;
  return {
    teamId: ctx?.teamId ?? null,
    memberId: ctx?.memberId ?? null,
    apiKeyId: ctx ? apiKeyId(ctx) : null,
    sessionKind:
      sessionKind ??
      (ctx
        ? entrypoint === "mcp" ||
          entrypoint === "hook" ||
          entrypoint === "installer"
          ? "api_key"
          : "web_session"
        : "anonymous"),
    requestId: randomUUID(),
    entrypoint,
    environment,
    isTest:
      environment === "test" || traffic === "synthetic"
        ? true
        : traffic === "real"
          ? false
          : null,
    testBasis:
      environment === "test"
        ? "unit_test"
        : traffic === "synthetic" || traffic === "real"
          ? "deployment"
          : "unclassified",
  };
}
export const currentOrigin = () => context.getStore()?.origin;
export function withOrigin<T>(
  origin: Origin,
  action: () => Promise<T>,
  writer?: EventWriter,
): Promise<T> {
  const parent = context.getStore();
  return context.run(
    {
      origin,
      writer: writer ?? parent?.writer ?? writeEvent,
      budget: parent?.budget ?? { remaining: 4000 },
      mutations: parent?.mutations,
    },
    action,
  );
}
export function withActor<T>(
  ctx: HiveContext,
  action: () => Promise<T>,
): Promise<T> {
  const parent = currentOrigin();
  return withOrigin(
    parent
      ? {
          ...parent,
          teamId: ctx.teamId,
          memberId: ctx.memberId,
          apiKeyId:
            apiKeyId(ctx) ??
            (parent.teamId === ctx.teamId && parent.memberId === ctx.memberId
              ? parent.apiKeyId
              : null),
        }
      : originFor(ctx),
    action,
  );
}
export function eventRow(input: EventInput) {
  const origin = input.origin ?? currentOrigin() ?? originFor();
  return {
    event_key: digest(`${input.name}:v1:${input.key ?? randomUUID()}`),
    event_name: z.enum(eventNames).parse(input.name),
    event_version: 1,
    occurred_at: input.occurredAt ?? new Date(),
    team_id: origin.teamId,
    member_id: origin.memberId,
    api_key_id: origin.apiKeyId,
    session_kind: origin.sessionKind,
    request_id: origin.requestId,
    learning_id: input.learningId ?? null,
    entrypoint: origin.entrypoint,
    environment: origin.environment,
    is_test: origin.isTest,
    test_basis: origin.testBasis,
    outcome: z.enum(outcomes).parse(input.outcome ?? "completed"),
    reason_code:
      input.reasonCode == null
        ? null
        : z.enum(reasonCodes).parse(input.reasonCode),
    latency_ms:
      input.latencyMs == null ? null : count.parse(Math.round(input.latencyMs)),
    properties: propertiesSchema.parse(input.properties ?? {}),
  };
}
let database: ReturnType<typeof postgres> | undefined;
export function getAnalyticsSql() {
  if (!process.env.DATABASE_URL)
    throw new Error("AnalyticsDatabaseUnavailable");
  database ??= postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: 2,
    connect_timeout: 1,
    idle_timeout: 20,
    connection: { statement_timeout: 450, application_name: "hive-analytics" },
  });
  return database;
}
export async function writeEvent(row: EventRow, signal: AbortSignal) {
  const database = getAnalyticsSql();
  if (signal.aborted) throw new Error("AnalyticsAborted");
  const query = database`INSERT INTO analytics_events ${database({ ...row, properties: database.json(row.properties) })} ON CONFLICT (event_key) DO NOTHING`;
  const cancel = () => {
    query.cancel();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await query;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
let lastDiagnostic = 0,
  failures = 0;
export async function recordEvent(input: EventInput): Promise<void> {
  const state = context.getStore();
  const budget = state?.budget ?? { remaining: 4000 };
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (budget.remaining <= 0) throw new Error("AnalyticsBudgetExhausted");
    const controller = new AbortController();
    await Promise.race([
      (state?.writer ?? writeEvent)(eventRow(input), controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            reject(new Error("AnalyticsTimeout"));
          },
          Math.min(500, budget.remaining),
        );
      }),
    ]);
  } catch {
    failures++;
    if (Date.now() - lastDiagnostic >= 60000) {
      console.error(
        JSON.stringify({
          event: "hive_analytics",
          code: "event_write_failed",
          name: input.name,
          failuresSinceLastDiagnostic: failures,
        }),
      );
      lastDiagnostic = Date.now();
      failures = 0;
    }
  } finally {
    if (timer) clearTimeout(timer);
    budget.remaining -= Math.max(1, Date.now() - started);
  }
}
export async function recordMutation(input: EventInput) {
  const state = context.getStore();
  if (state?.mutations)
    state.mutations.push({ ...input, origin: input.origin ?? state.origin });
  else await recordEvent(input);
}
export async function analyticsTransaction<T>(
  action: () => Promise<T>,
): Promise<T> {
  const state = context.getStore();
  const mutations: EventInput[] = [];
  const result = await context.run(
    {
      origin: state?.origin ?? originFor(),
      writer: state?.writer ?? writeEvent,
      budget: state?.budget ?? { remaining: 4000 },
      mutations,
    },
    action,
  );
  async function flush(index: number): Promise<void> {
    if (index >= mutations.length) return;
    await recordMutation(mutations[index]);
    await flush(index + 1);
  }
  await flush(0);
  return result;
}
export function pushSource(
  source: "claude-code" | "codex" | "manual",
): NonNullable<Properties["source"]> {
  const entrypoint = currentOrigin()?.entrypoint;
  if (entrypoint === "hook" || entrypoint === "slack") return entrypoint;
  return source === "manual"
    ? entrypoint === "web"
      ? "web"
      : "unknown"
    : source;
}
export async function accessEvent(
  ctx: HiveContext | undefined,
  outcome: EventInput["outcome"],
  properties: Properties = {},
  key?: string,
) {
  const action = () =>
    recordEvent({
      name: "access.changed",
      outcome,
      key,
      properties: {
        actorKind: ctx ? "member" : "anonymous",
        role: ctx ? roles.get(ctx) : null,
        ...properties,
      },
    });
  return ctx ? withActor(ctx, action) : action();
}
export async function withOperation<T>(
  ctx: HiveContext,
  operation: NonNullable<Properties["operation"]>,
  action: () => Promise<T>,
): Promise<T> {
  return withActor(ctx, async () => {
    const operationId = randomUUID(),
      started = performance.now();
    await recordEvent({
      name: "operation.started",
      key: operationId,
      outcome: "started",
      properties: { operation, operationId },
    });
    try {
      const result = await action();
      await recordEvent({
        name: "operation.finished",
        key: operationId,
        properties: { operation, operationId },
        latencyMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      const status =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        typeof error.status === "number"
          ? error.status
          : 500;
      const reasonCode =
        status === 400
          ? "invalid_input"
          : status === 404
            ? "not_found"
            : status === 401 || status === 403
              ? "access_denied"
              : status === 409
                ? "revision_conflict"
                : status === 429
                  ? "rate_limited"
                  : "request_failed";
      await recordEvent({
        name: "operation.finished",
        key: operationId,
        outcome: status < 500 ? "refused" : "failed",
        reasonCode,
        properties: { operation, operationId },
        latencyMs: performance.now() - started,
      });
      throw error;
    }
  });
}
export async function beginCall(
  kind: "model" | "classifier",
  purpose: NonNullable<Properties["purpose"]>,
  model: NonNullable<Properties["model"]>,
) {
  const callId = randomUUID();
  await recordEvent({
    name: `${kind}.started`,
    key: callId,
    outcome: "started",
    properties: { callId, purpose, model, requestedModel: model },
  });
  const started = performance.now();
  return (
    outcome: EventInput["outcome"] = "completed",
    reasonCode?: EventInput["reasonCode"],
    usage: Properties = {},
  ) =>
    recordEvent({
      name: `${kind}.completed`,
      key: callId,
      outcome,
      reasonCode,
      latencyMs: performance.now() - started,
      properties: {
        callId,
        purpose,
        requestedModel: model,
        model: null,
        ...usage,
      },
    });
}
