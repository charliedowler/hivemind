import type postgres from "postgres";
import {
  composeDigest,
  type DigestData,
  type DigestItem,
  type DigestFriction,
  type DigestIncludes,
} from "@hivemind/core";
import { getSql } from "../db/client";

type Sql = postgres.Sql | postgres.TransactionSql;
export async function gatherDigest(
  teamId: string,
  since: Date,
  tx: Sql = getSql(),
  linkedAuthors: Map<string, string> = new Map(),
  scheduleId?: string,
  periodSince = since,
  publicOnly = false,
) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${teamId}),7291)`;
  const [clock] =
    await tx`SELECT date_trunc('milliseconds',clock_timestamp()) + interval '1 millisecond' AS until`;
  const until = clock!.until as Date;
  const [column] =
    await tx`SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='learnings'::regclass AND attname='capture_flagged' AND NOT attisdropped) AS present`;
  const unflagged = column!.present ? tx`l.capture_flagged=false` : tx`TRUE`;
  const olderUnflagged = column!.present
    ? tx`older.capture_flagged=false`
    : tx`TRUE`;
  const successorUnflagged = column!.present
    ? tx`successor.capture_flagged=false`
    : tx`TRUE`;
  const [cells, friction, decisions] = await Promise.all([
    tx`SELECT l.id,l.revision,l.title,l.kind,l.lifecycle,CASE WHEN ${successorUnflagged} THEN l.superseded_by ELSE NULL END AS superseded_by,m.id AS member_id,m.name FROM learnings l LEFT JOIN learnings successor ON successor.id=l.superseded_by AND successor.team_id=l.team_id LEFT JOIN learning_versions latest ON latest.team_id=l.team_id AND latest.learning_id=l.id AND latest.revision=l.revision JOIN members m ON m.id=coalesce(latest.member_id,l.member_id) WHERE l.team_id=${teamId} AND l.lifecycle IN ('fresh','confirmed','superseded') AND ${unflagged} AND (${!publicOnly} OR l.source <> 'slack') AND ((l.created_at > ${since} AND l.created_at <= ${until}) OR EXISTS(SELECT 1 FROM learning_versions v WHERE v.team_id=l.team_id AND v.learning_id=l.id AND v.created_at > ${since} AND v.created_at <= ${until} AND (v.revision > 1 OR v.content->>'lifecycle'='confirmed'))) AND (${scheduleId ?? null}::text IS NULL OR NOT EXISTS(SELECT 1 FROM slack_digest_receipts r WHERE r.team_id=l.team_id AND r.schedule_id=${scheduleId ?? null} AND r.source_key=l.id||':'||l.revision::text)) ORDER BY l.updated_at DESC,l.id`,
    tx`SELECT p.id AS push_id,p.learning_id AS id,l.title,p.area,p.cost,p.blocked,l.workaround,m.id AS member_id,m.name FROM learning_pushes p JOIN learnings l ON l.id=p.learning_id AND l.team_id=p.team_id JOIN members m ON m.id=p.member_id WHERE p.team_id=${teamId} AND NOT p.is_correction AND l.kind='friction' AND ${unflagged} AND (${!publicOnly} OR l.source <> 'slack') AND l.lifecycle IN ('fresh','confirmed') AND p.created_at > ${since} AND p.created_at <= ${until} AND (${scheduleId ?? null}::text IS NULL OR NOT EXISTS(SELECT 1 FROM slack_digest_receipts r WHERE r.team_id=p.team_id AND r.schedule_id=${scheduleId ?? null} AND r.source_key=p.id)) ORDER BY p.created_at DESC,p.id`,
    tx`SELECT d.id,d.decision,l.id AS cell_id,l.title,m.id AS member_id,m.name FROM conflict_decisions d JOIN learning_supersessions e ON e.id=d.edge_id AND e.team_id=d.team_id JOIN learnings l ON l.id=e.newer_id AND l.team_id=e.team_id JOIN learnings older ON older.id=e.older_id AND older.team_id=e.team_id JOIN members m ON m.id=d.pushed_by WHERE d.team_id=${teamId} AND ${unflagged} AND ${olderUnflagged} AND (${!publicOnly} OR l.source <> 'slack') AND d.created_at > ${since} AND d.created_at <= ${until} AND d.model NOT IN ('legacy','admin') AND (${scheduleId ?? null}::text IS NULL OR NOT EXISTS(SELECT 1 FROM slack_digest_receipts r WHERE r.team_id=d.team_id AND r.schedule_id=${scheduleId ?? null} AND r.source_key=d.id)) ORDER BY d.created_at DESC,d.id`,
  ]);
  const author = (row: Record<string, unknown>) => ({
    name: String(row.name),
    slackId: linkedAuthors.get(String(row.member_id)) ?? null,
  });
  const item = (r: Record<string, unknown>): DigestItem => ({
    id: String(r.id),
    sourceKey: `${r.id}:${r.revision}`,
    title: String(r.title),
    author: author(r),
    state: String(r.lifecycle),
    replacementId: r.superseded_by ? String(r.superseded_by) : null,
  });
  const data: DigestData = {
    since: periodSince.toISOString(),
    until: until.toISOString(),
    learnings: cells
      .filter((r) => !["insight", "friction"].includes(r.kind))
      .map(item),
    insights: cells.filter((r) => r.kind === "insight").map(item),
    friction: friction.map((r): DigestFriction => ({
      ...item(r),
      sourceKey: String(r.push_id),
      area: String(r.area ?? "Unspecified"),
      minutes: r.cost === null ? null : Number(r.cost),
      blocked: r.blocked == null ? null : Boolean(r.blocked),
      workaround: r.workaround ? String(r.workaround) : null,
    })),
    decisions: decisions.map((r) => ({
      id: String(r.cell_id),
      sourceKey: String(r.id),
      title: `${({ supersede: "Hive replaced an earlier cell with this cell", keep_old: "Hive merged this cell into an earlier cell", mark_outdated: "Hive marked this cell outdated", retract_new: "Hive removed this cell", keep_both: "Hive kept both cells", reversed: "Hive reversed a change to this cell" } as Record<string, string>)[String(r.decision)] ?? "Hive reviewed this cell"}: ${r.title}`,
      author: author(r),
    })),
  };
  return data;
}
export async function digestPreview(
  teamId: string,
  since: Date,
  include: DigestIncludes,
  timezone: string,
  linkedAuthors?: Map<string, string>,
  scheduleId?: string,
  coverageStart = since,
  publicOnly = false,
) {
  return getSql().begin(async (tx) =>
    composeDigest(
      await gatherDigest(
        teamId,
        coverageStart,
        tx,
        linkedAuthors,
        scheduleId,
        since,
        publicOnly,
      ),
      include,
      timezone,
    ),
  );
}
