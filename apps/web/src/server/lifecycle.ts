import {
  analyticsTransaction,
  recordMutation,
  withActor,
} from "./analytics/events";
import { scheduleKnowledge } from "./knowledge-tree";
import type postgres from "postgres";
import {
  learningEditInput,
  redactSecrets,
  type HiveContext,
  type LearningConflict,
  type LearningVersion,
  type LearningKind,
} from "@hivemind/core";
import type { z } from "zod";
import { getSql, hasEmbeddingColumn } from "./db/client";
import { HiveError, HiveInputError, HiveNotFoundError } from "./errors";
import { embedText } from "./llm/embeddings";

export type LearningTransaction = postgres.TransactionSql;

export async function lockLearningWrites(
  tx: LearningTransaction,
  ctx: HiveContext,
) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${ctx.teamId}), 7291)`;
  await tx`SELECT set_config('hive.actor', ${ctx.memberId}, true)`;
}

export function verificationHorizon(
  kind: LearningKind,
  area: string | undefined,
  tags: string[],
  explicit?: string,
): Date {
  if (explicit) return new Date(explicit);
  let days = {
    learning: 90,
    insight: 90,
    gotcha: 45,
    friction: 45,
    decision: 180,
    snippet: 30,
    incident: 30,
  }[kind];
  if (area === "environment") days = 14;
  if (
    tags.some((tag) => /^(versions?|dependencies|dependency|urls?)$/.test(tag))
  )
    days = Math.min(days, 30);
  return new Date(Date.now() + days * 86400000);
}

export async function acceptSupersession(
  tx: LearningTransaction,
  ctx: HiveContext,
  edgeId: string,
  reason: string,
) {
  const edges =
    await tx`SELECT * FROM learning_supersessions WHERE id = ${edgeId} AND team_id = ${ctx.teamId} FOR UPDATE`;
  const edge = edges[0];
  if (!edge) throw new HiveNotFoundError("Conflict not found in your team.");
  if (edge.status === "accepted") return;
  if (edge.status !== "candidate")
    throw new HiveInputError("This conflict is already resolved.");
  const cells =
    await tx`SELECT id, revision, lifecycle FROM learnings WHERE team_id = ${ctx.teamId} AND id = ANY(${[edge.older_id, edge.newer_id]}::text[]) ORDER BY id FOR UPDATE`;
  const older = cells.find((row) => row.id === edge.older_id),
    newer = cells.find((row) => row.id === edge.newer_id);
  if (!older || !newer) throw new HiveNotFoundError();
  if (
    older.revision !== edge.older_revision ||
    newer.revision !== edge.newer_revision
  )
    throw new HiveError(
      "A cell changed after this conflict was proposed. Review a new correction.",
      409,
    );
  if (
    !["fresh", "confirmed", "outdated"].includes(older.lifecycle) ||
    !["fresh", "confirmed"].includes(newer.lifecycle)
  )
    throw new HiveError("Replace the current cell in the chain instead.", 409);
  const cycle =
    await tx`WITH RECURSIVE successors(id) AS (SELECT newer_id FROM learning_supersessions WHERE team_id = ${ctx.teamId} AND older_id = ${edge.newer_id} AND status = 'accepted' UNION SELECT s.newer_id FROM learning_supersessions s JOIN successors p ON s.older_id = p.id WHERE s.team_id = ${ctx.teamId} AND s.status = 'accepted') SELECT id FROM successors WHERE id = ${edge.older_id}`;
  if (edge.older_id === edge.newer_id || cycle.length)
    throw new HiveInputError("A replacement cannot create a cycle.");
  await tx`UPDATE learnings SET lifecycle = 'superseded', superseded_by = ${edge.newer_id} WHERE id = ${edge.older_id} AND team_id = ${ctx.teamId}`;
  await tx`UPDATE learning_supersessions SET status = 'accepted', reason = ${reason}, decided_by = ${ctx.memberId}, decided_at = now() WHERE id = ${edgeId} AND team_id = ${ctx.teamId}`;
  await recordMutation({
    name: "learning.superseded",
    key: edgeId,
    learningId: edge.older_id,
    properties: { newerLearningId: edge.newer_id },
  });
  await recordMutation({
    name: "learning.lifecycle_changed",
    key: edgeId,
    learningId: edge.older_id,
    reasonCode: "replacement",
    properties: { previousState: older.lifecycle, state: "superseded" },
  });
}

export async function listConflicts(
  ctx: HiveContext,
  history = false,
): Promise<LearningConflict[]> {
  const rows =
    await getSql()`SELECT s.*, a.title AS older_title, a.body AS older_body, a.revision AS current_older_revision, b.title AS newer_title, b.body AS newer_body, b.revision AS current_newer_revision, am.name AS older_author, bm.name AS newer_author, (SELECT count(*)::int FROM learning_conflict_votes v WHERE v.edge_id = s.id AND v.team_id = ${ctx.teamId}) AS votes, EXISTS (SELECT 1 FROM learning_conflict_votes v WHERE v.edge_id = s.id AND v.team_id = ${ctx.teamId} AND v.member_id = ${ctx.memberId}) AS voted, EXISTS (SELECT 1 FROM members m WHERE m.id = ${ctx.memberId} AND m.team_id = ${ctx.teamId} AND m.role = 'admin' AND m.removed_at IS NULL) AS can_admin FROM learning_supersessions s JOIN learnings a ON a.id = s.older_id AND a.team_id = s.team_id JOIN learnings b ON b.id = s.newer_id AND b.team_id = s.team_id JOIN members am ON am.id = a.member_id AND am.team_id = a.team_id JOIN members bm ON bm.id = b.member_id AND bm.team_id = b.team_id WHERE s.team_id = ${ctx.teamId} AND (${history} OR s.status = 'candidate') ORDER BY s.created_at DESC LIMIT 100`;
  return rows.map((row) => ({
    id: row.id,
    older: {
      id: row.older_id,
      title: row.older_title,
      body: row.older_body,
      author: row.older_author,
      revision: row.current_older_revision,
    },
    newer: {
      id: row.newer_id,
      title: row.newer_title,
      body: row.newer_body,
      author: row.newer_author,
      revision: row.current_newer_revision,
    },
    relation: row.relation,
    confidence: Number(row.confidence),
    status: row.status,
    reason: row.reason,
    votes: Number(row.votes),
    voted: row.voted,
    canAdmin: row.can_admin,
    stale:
      row.status === "candidate" &&
      (row.older_revision !== row.current_older_revision ||
        row.newer_revision !== row.current_newer_revision),
    createdAt: row.created_at.toISOString(),
  }));
}

export function resolveConflict(
  ctx: HiveContext,
  id: string,
  action: "confirm" | "reject",
) {
  return withActor(ctx, () => resolveConflictAction(ctx, id, action));
}
async function resolveConflictAction(
  ctx: HiveContext,
  id: string,
  action: "confirm" | "reject",
) {
  const result = await analyticsTransaction(() =>
    getSql().begin(async (tx) => {
      await lockLearningWrites(tx, ctx);
      const members =
        await tx`SELECT role FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND removed_at IS NULL`;
      if (!members.length) throw new HiveNotFoundError("Member not found.");
      const admin = members[0].role === "admin";
      const edges =
        await tx`SELECT status FROM learning_supersessions WHERE id = ${id} AND team_id = ${ctx.teamId} FOR UPDATE`;
      if (!edges.length)
        throw new HiveNotFoundError("Conflict not found in your team.");
      if (edges[0].status !== "candidate")
        throw new HiveError("This conflict is already resolved.", 409);
      if (action === "reject") {
        if (!admin)
          throw new HiveError(
            "A team admin is needed to reject a replacement.",
            403,
          );
        await tx`UPDATE learning_supersessions SET status = 'rejected', reason = 'Admin keeps both cells', decided_by = ${ctx.memberId}, decided_at = now() WHERE id = ${id} AND team_id = ${ctx.teamId}`;
        return { status: "rejected" };
      }
      await tx`INSERT INTO learning_conflict_votes (edge_id, team_id, member_id) VALUES (${id}, ${ctx.teamId}, ${ctx.memberId}) ON CONFLICT DO NOTHING`;
      const votes =
        await tx`SELECT count(*)::int AS count FROM learning_conflict_votes v JOIN members m ON m.id = v.member_id AND m.team_id = v.team_id WHERE v.edge_id = ${id} AND v.team_id = ${ctx.teamId} AND m.removed_at IS NULL`;
      if (admin || votes[0].count >= 2) {
        await acceptSupersession(
          tx,
          ctx,
          id,
          admin
            ? "Admin confirms replacement"
            : "Two members confirm replacement",
        );
        return { status: "accepted" };
      }
      return { status: "candidate" };
    }),
  );
  scheduleKnowledge(ctx);
  return result;
}

export async function learningVersions(
  ctx: HiveContext,
  id: string,
): Promise<LearningVersion[]> {
  const rows =
    await getSql()`SELECT v.*, m.name AS author FROM learning_versions v JOIN members m ON m.id = v.member_id AND m.team_id = v.team_id WHERE v.learning_id = ${id} AND v.team_id = ${ctx.teamId} ORDER BY v.revision DESC LIMIT 100`;
  if (!rows.length) throw new HiveNotFoundError();
  return rows.map((row) => ({
    revision: row.revision,
    author: row.author,
    createdAt: row.created_at.toISOString(),
    content: row.content,
    diff: row.diff,
  }));
}

export function editLearning(
  ctx: HiveContext,
  id: string,
  input: z.infer<typeof learningEditInput>,
) {
  return withActor(ctx, () => editLearningAction(ctx, id, input));
}
async function editLearningAction(
  ctx: HiveContext,
  id: string,
  input: z.infer<typeof learningEditInput>,
) {
  const data = learningEditInput.parse(input);
  const result = await analyticsTransaction(() =>
    getSql().begin(async (tx) => {
      await lockLearningWrites(tx, ctx);
      const rows =
        await tx`SELECT l.*, EXISTS (SELECT 1 FROM members m WHERE m.id = ${ctx.memberId} AND m.team_id = ${ctx.teamId} AND m.role = 'admin' AND m.removed_at IS NULL) AS admin FROM learnings l WHERE l.id = ${id} AND l.team_id = ${ctx.teamId} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new HiveNotFoundError();
      if (row.member_id !== ctx.memberId && !row.admin)
        throw new HiveError(
          "Only the author or a team admin can edit this cell.",
          403,
        );
      if (row.revision !== data.revision)
        throw new HiveError(
          "This cell changed. Reload it before editing.",
          409,
        );
      if (row.lifecycle === "superseded")
        throw new HiveError("Edit the current cell in the chain instead.", 409);
      const title = redactSecrets(data.title ?? row.title).text,
        body = redactSecrets(data.body ?? row.body).text;
      if (
        row.admin_outdated &&
        data.lifecycle &&
        ["fresh", "confirmed"].includes(data.lifecycle) &&
        !row.admin
      )
        throw new HiveError("A team admin must clear the outdated mark.", 403);
      await tx`UPDATE learnings SET title = ${title}, body = ${body}, verify_after = ${data.verify_after ? new Date(data.verify_after) : row.verify_after}, lifecycle = ${data.lifecycle ?? row.lifecycle}, admin_outdated = ${data.lifecycle && ["fresh", "confirmed"].includes(data.lifecycle) ? false : row.admin_outdated} WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      if ((data.title || data.body) && (await hasEmbeddingColumn())) {
        const embedding = await embedText(`${title}\n\n${body}`);
        await tx`UPDATE learnings SET embedding = ${embedding ? JSON.stringify(embedding) : null}::vector WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      }
      const updated =
        await tx`SELECT revision FROM learnings WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      if (data.lifecycle && data.lifecycle !== row.lifecycle)
        await recordMutation({
          name: "learning.lifecycle_changed",
          learningId: id,
          reasonCode: "manual",
          properties: { previousState: row.lifecycle, state: data.lifecycle },
        });
      return { revision: updated[0].revision };
    }),
  );
  scheduleKnowledge(ctx);
  return result;
}

export async function answerLifecycleContext(
  ctx: HiveContext,
  hits: import("@hivemind/core").LearningView[],
) {
  const ids = hits.map((hit) => hit.id);
  const rows = ids.length
    ? await getSql()`WITH RECURSIVE history AS (SELECT s.older_id, s.newer_id, s.decided_at, 1 AS depth FROM learning_supersessions s WHERE s.team_id = ${ctx.teamId} AND s.newer_id = ANY(${ids}::text[]) AND s.status = 'accepted' UNION ALL SELECT s.older_id, s.newer_id, s.decided_at, h.depth + 1 FROM learning_supersessions s JOIN history h ON s.newer_id = h.older_id WHERE s.team_id = ${ctx.teamId} AND s.status = 'accepted' AND h.depth < 16) SELECT DISTINCT h.*, l.title, n.title AS newer_title, l.last_pushed_at AS older_date, n.last_pushed_at AS newer_date FROM history h JOIN learnings l ON l.id = h.older_id AND l.team_id = ${ctx.teamId} JOIN learnings n ON n.id = h.newer_id AND n.team_id = ${ctx.teamId} ORDER BY h.depth, h.older_id`
    : [];
  const asOf = new Date().toISOString();
  const lines = [`As of ${asOf.slice(0, 10)}.`];
  const citations: import("@hivemind/core").AskCitation[] = rows.flatMap(
    (row) => [
      {
        id: String(row.older_id),
        title: String(row.title),
        why: "Historical cell replaced by a newer learning.",
        date: new Date(row.older_date).toISOString().slice(0, 10),
      },
      {
        id: String(row.newer_id),
        title: String(row.newer_title),
        why: "Replacement in this learning's history.",
        date: new Date(row.newer_date).toISOString().slice(0, 10),
      },
    ],
  );
  for (const row of rows)
    lines.push(
      `Replaced [${row.older_id}] with [${row.newer_id}] on ${new Date(row.decided_at).toISOString().slice(0, 10)}.`,
    );
  for (const hit of hits.filter((hit) => hit.verifyBeforeUse))
    lines.push(
      `Verify before use: [${hit.id}] passed its verification date ${hit.verifyAfter?.slice(0, 10)}.`,
    );
  if (rows.some((row) => row.depth === 16))
    lines.push(
      "Earlier history is truncated after 16 links. Read the oldest cited cell for more context.",
    );
  return {
    prompt: JSON.stringify({
      asOf,
      history: rows.map((row) => ({
        older: row.older_id,
        title: row.title,
        newer: row.newer_id,
        date: row.decided_at,
      })),
      verifyBeforeUse: hits
        .filter((hit) => hit.verifyBeforeUse)
        .map((hit) => hit.id),
    }),
    text: lines.join("\n\n"),
    citations,
  };
}

export function appendLifecycleContext(
  result: import("@hivemind/core").AskResult,
  context: Awaited<ReturnType<typeof answerLifecycleContext>>,
) {
  const primaryIds = new Set(result.citations.map((citation) => citation.id));
  const titles = new Map(
    context.citations.map((citation) => [
      citation.id,
      citation.title.trim().toLowerCase(),
    ]),
  );
  const paragraphs = context.text.split("\n\n").filter((paragraph) => {
    const replacement =
      /^Replaced \[(lrn_[a-z0-9]+)\] with \[(lrn_[a-z0-9]+)\]/.exec(paragraph);
    if (replacement)
      return (
        (primaryIds.has(replacement[1]) || primaryIds.has(replacement[2])) &&
        titles.get(replacement[1]) !== titles.get(replacement[2])
      );
    const ids = [...paragraph.matchAll(/\[(lrn_[a-z0-9]+)\]/g)].map(
      (match) => match[1],
    );
    return !ids.length || ids.some((id) => primaryIds.has(id));
  });
  const hasReplacement = paragraphs.some((paragraph) =>
    paragraph.startsWith("Replaced "),
  );
  const relevantParagraphs = paragraphs.filter(
    (paragraph) =>
      !paragraph.startsWith("Earlier history is truncated") || hasReplacement,
  );
  const historyIds = new Set(
    relevantParagraphs.flatMap((paragraph) =>
      [...paragraph.matchAll(/\[(lrn_[a-z0-9]+)\]/g)].map((match) => match[1]),
    ),
  );
  return {
    ...result,
    answer: `${result.answer}\n\n${relevantParagraphs.join("\n\n")}`,
    citations: [
      ...new Map(
        [
          ...result.citations,
          ...context.citations.filter((citation) =>
            historyIds.has(citation.id),
          ),
        ].map((citation) => [citation.id, citation]),
      ).values(),
    ],
  };
}
