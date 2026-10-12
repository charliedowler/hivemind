import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  eventRow,
  originFor,
  type EventInput,
  type EventRow,
  type Origin,
} from "./events";

export const fixtureTeam = "team_aaaaaaaaaaaa",
  fixtureMember = "mem_aaaaaaaaaaaa";
export const fixtureOtherTeam = "team_bbbbbbbbbbbb",
  fixtureOtherMember = "mem_bbbbbbbbbbbb";
export const fixtureContext = {
  teamId: fixtureTeam,
  teamName: "Analytics fixture",
  memberId: fixtureMember,
  memberName: "Fixture admin",
};
export function fixtureEvents(): EventRow[] {
  const origin = {
    ...originFor(fixtureContext, "mcp"),
    environment: "development" as const,
    isTest: true,
    testBasis: "simulation" as const,
  };
  const rows: EventRow[] = [];
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - 1);
  let sequence = 0;
  const add = (input: EventInput, extra: Partial<Origin> = {}) =>
    rows.push(
      eventRow({
        ...input,
        key: `fixture-${sequence++}`,
        origin: { ...origin, requestId: randomUUID(), ...extra },
        occurredAt: new Date(day.getTime() + sequence * 1000),
      }),
    );
  add(
    {
      name: "access.changed",
      outcome: "signup",
      properties: {
        actorKind: "member",
        role: "admin",
        earlyAccessId: "ea_aaaaaaaaaaaa",
      },
    },
    { entrypoint: "web" },
  );
  add(
    {
      name: "access.changed",
      outcome: "key_created",
      properties: { keyId: "key_aaaaaaaaaaaa" },
    },
    { entrypoint: "web" },
  );
  add({
    name: "learning.pushed",
    properties: {
      kind: "gotcha",
      source: "codex",
      merged: false,
      sensitiveRefused: false,
    },
  });
  add({
    name: "learning.pushed",
    properties: {
      kind: "gotcha",
      source: "codex",
      merged: true,
      sensitiveRefused: false,
    },
  });
  add({
    name: "learning.pushed",
    properties: {
      kind: "friction",
      source: "claude-code",
      merged: false,
      frictionMinutes: 12,
      blocked: true,
    },
  });
  add({
    name: "learning.pushed",
    properties: {
      kind: "friction",
      source: "claude-code",
      merged: true,
      frictionMinutes: null,
    },
  });
  add({
    name: "learning.superseded",
    learningId: "lrn_aaaaaaaaaaaa",
    properties: { newerLearningId: "lrn_bbbbbbbbbbbb" },
  });
  const askRequest = randomUUID();
  add(
    {
      name: "search.performed",
      latencyMs: 40,
      properties: {
        resultCount: 3,
        topScoreBand: "high",
        vectorUsed: true,
        textUsed: true,
      },
    },
    { requestId: askRequest },
  );
  add(
    {
      name: "ask.performed",
      outcome: "answer",
      latencyMs: 100,
      properties: {
        retrievedCount: 3,
        citedCount: 2,
        gateDecision: "answer",
        gapReported: false,
        synthesized: true,
      },
    },
    { requestId: askRequest },
  );
  add(
    {
      name: "ask.performed",
      outcome: "gap",
      latencyMs: 300,
      properties: {
        retrievedCount: 0,
        citedCount: 0,
        gateDecision: "gap",
        gapReported: true,
        synthesized: false,
      },
    },
    { entrypoint: "web" },
  );
  add({
    name: "learning.pushed",
    outcome: "refused",
    reasonCode: "sensitive_refused",
    properties: {
      kind: "learning",
      source: "codex",
      sensitiveRefused: true,
      sensitiveProbability: 0.99,
    },
  });
  add({
    name: "model.completed",
    outcome: "failed",
    reasonCode: "provider_failed",
    latencyMs: 700,
    properties: {
      model: "text-embedding-3-small",
      purpose: "embedding",
      callId: randomUUID(),
    },
  });
  add({
    name: "model.started",
    outcome: "started",
    properties: {
      model: "claude-sonnet-5-5",
      purpose: "synthesis",
      callId: randomUUID(),
    },
  });
  const callId = randomUUID(),
    requestId = randomUUID();
  add(
    {
      name: "classifier.started",
      outcome: "started",
      properties: { purpose: "ask", model: "jev-1.13.0", callId },
    },
    { requestId },
  );
  add(
    {
      name: "classifier.completed",
      latencyMs: 50,
      properties: { purpose: "ask", model: "jev-1.13.0", callId },
    },
    { requestId },
  );
  add({
    name: "operation.started",
    outcome: "started",
    properties: { operation: "push", operationId: randomUUID() },
  });
  add(
    { name: "recent.performed", properties: { resultCount: 4 } },
    { teamId: fixtureOtherTeam, memberId: fixtureOtherMember },
  );
  add(
    { name: "recent.performed", properties: { resultCount: 2 } },
    { isTest: null, testBasis: "unclassified" },
  );
  add(
    { name: "recent.performed", properties: { resultCount: 1 } },
    { isTest: false, testBasis: "deployment" },
  );
  for (let days = 7; days >= 2; days--) {
    for (let n = 0; n < (days % 4) + 1; n++) {
      add({ name: "recent.performed", properties: { resultCount: days } });
      rows[rows.length - 1].occurred_at = new Date(
        day.getTime() - (days - 1) * 86400000 + n * 1000,
      );
    }
  }
  return rows;
}
export async function seedFixture(sql: postgres.Sql) {
  const rows = fixtureEvents();
  await sql`INSERT INTO analytics_events ${sql(rows.map((row) => ({ ...row, properties: sql.json(row.properties) })))} ON CONFLICT DO NOTHING`;
  return rows;
}
