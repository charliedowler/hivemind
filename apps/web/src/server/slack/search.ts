import {
  hiveSlackSearchInput,
  parseSince,
  rankCandidates,
  type HiveContext,
  type HiveSlackSearchInput,
  type LearningView,
  type SearchHit,
} from "@hivemind/core";
import { getSql } from "../db/client";
import { embedText } from "../llm/embeddings";
import { slackEmbeddingAvailable } from "./store";
import { validateChannel } from "./install";
import { HiveError } from "../errors";

export function slackView(row: Record<string, unknown>): LearningView {
  const date = new Date(row.posted_at as Date).toISOString();
  return {
    id: String(row.id),
    title: String(row.text).split("\n")[0].slice(0, 140),
    body: String(row.text),
    kind: "learning",
    source: "slack",
    tags: ["slack"],
    repo: null,
    paths: [],
    confidence: 0.7,
    author: { id: String(row.author_id), name: String(row.author_name) },
    pushCount: 1,
    votes: { up: 0, down: 0, outdated: 0 },
    lifecycle: "fresh",
    createdAt: date,
    updatedAt: new Date(row.updated_at as Date).toISOString(),
    lastPushedAt: date,
    permalink: String(row.permalink),
    slackChannel: String(row.channel_name),
  };
}
export async function searchSlack(
  ctx: HiveContext,
  input: HiveSlackSearchInput,
  publicOnly = false,
): Promise<SearchHit[]> {
  const data = hiveSlackSearchInput.parse(input);
  const sql = getSql();
  let since: Date;
  try {
    since = data.since ? parseSince(data.since) : new Date(0);
  } catch {
    throw new HiveError("Use an ISO date or a time window such as 7d.", 400);
  }
  const allowed =
    await sql`SELECT c.channel_id FROM slack_channels c JOIN slack_installations i ON i.team_id=c.team_id WHERE c.team_id=${ctx.teamId} AND c.state IN ('enabled','paused') AND c.bot_member=true AND i.active=true AND (${!publicOnly} OR c.private=false) AND (${data.channel ?? null}::text IS NULL OR c.channel_id=${data.channel ?? null} OR c.name=${data.channel?.replace(/^#/, "") ?? null})`;
  if (allowed.length > 100)
    throw new HiveError(
      "Use a channel filter to search more than 100 Slack channels.",
      400,
    );
  const verified: string[] = [];
  for (let offset = 0; offset < allowed.length; offset += 4) {
    const checks = await Promise.allSettled(
      allowed.slice(offset, offset + 4).map(async (row) => {
        await validateChannel(ctx.teamId, String(row.channel_id));
        return String(row.channel_id);
      }),
    );
    for (const check of checks)
      if (check.status === "fulfilled") verified.push(check.value);
  }
  if (!verified.length) return [];
  const filter = sql`m.channel_id=ANY(${verified}::text[]) AND m.team_id=${ctx.teamId} AND c.state IN ('enabled','paused') AND c.bot_member=true AND i.active=true AND (${!publicOnly} OR c.private=false) AND (${data.channel ?? null}::text IS NULL OR c.channel_id=${data.channel ?? null} OR c.name=${data.channel?.replace(/^#/, "") ?? null}) AND m.posted_at>=${since}`;
  const query = sql`replace(plainto_tsquery('english',${data.query})::text,'&','|')::tsquery`;
  const columns = sql`m.*,c.name AS channel_name`;
  const joins = sql`slack_messages m JOIN slack_channels c ON c.team_id=m.team_id AND c.channel_id=m.channel_id JOIN slack_installations i ON i.team_id=m.team_id`;
  const vector = await slackEmbeddingAvailable().then((yes) =>
    yes ? embedText(data.query) : null,
  );
  const [fts, semantic] = await Promise.all([
    sql`SELECT ${columns},ts_rank_cd(m.search,${query}) AS fts FROM ${joins} WHERE ${filter} AND m.search @@ ${query} ORDER BY fts DESC LIMIT 40`,
    vector
      ? sql`SELECT ${columns},1-(m.embedding <=> ${JSON.stringify(vector)}::vector) AS vector,ts_rank_cd(m.search,${query}) AS fts FROM ${joins} WHERE ${filter} AND m.embedding IS NOT NULL AND 1-(m.embedding <=> ${JSON.stringify(vector)}::vector)>=0.3 ORDER BY m.embedding <=> ${JSON.stringify(vector)}::vector LIMIT 40`
      : Promise.resolve([]),
  ]);
  const candidates = new Map<
    string,
    LearningView & { vector: number | null; fts: number }
  >();
  for (const row of fts)
    candidates.set(row.id, {
      ...slackView(row),
      vector: null,
      fts: Number(row.fts),
    });
  for (const row of semantic)
    candidates.set(row.id, {
      ...slackView(row),
      vector: Number(row.vector),
      fts: Number(row.fts),
    });
  return rankCandidates([...candidates.values()])
    .map((hit) => ({ ...hit, score: hit.score * 0.7 }))
    .slice(0, data.limit);
}
export async function getSlackMessage(ctx: HiveContext, id: string) {
  const rows =
    await getSql()`SELECT m.*,c.name AS channel_name FROM slack_messages m JOIN slack_channels c ON c.team_id=m.team_id AND c.channel_id=m.channel_id JOIN slack_installations i ON i.team_id=m.team_id WHERE m.team_id=${ctx.teamId} AND m.id=${id} AND c.state IN ('enabled','paused') AND c.bot_member=true AND i.active=true`;
  if (!rows[0]) return null;
  try {
    await validateChannel(ctx.teamId, String(rows[0].channel_id));
  } catch {
    return null;
  }
  return slackView(rows[0]);
}
