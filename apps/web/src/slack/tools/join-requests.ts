import type postgres from "postgres";
import { z } from "zod";
import type { SlackTool, SlackToolContext } from "./index";
import type { SlackActionableNotice } from "./context";
import { toolActor } from "./context";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";
import { decideDecisiveness } from "@/server/slack/decisiveness";
import { runReversibleAction } from "@/server/slack/actions";
import { slackPlainText } from "@/server/slack/format";
import {
  decideJoinRequestInTransaction,
  deliverJoinDecline,
} from "@/server/identity/join-requests";

const input = z.strictObject({
  decision: z.enum(["approve", "decline"]),
  requestId: z.string().max(100).optional(),
  person: z.string().max(200).optional(),
});
type JoinDecisionInput = z.infer<typeof input>;
const askWho = "Who should I approve or decline? Include their name or email.";

// Join-request notices this message may answer: the notice that started this thread, or in a
// top-level DM reply, every pending notice Hive sent this admin in the DM.
export async function joinRequestNotices(
  ctx: SlackToolContext,
  messageTs: string,
): Promise<SlackActionableNotice[]> {
  if (!ctx.isAdmin) return [];
  const topLevelDm = ctx.channelId.startsWith("D") && ctx.threadTs === messageTs;
  const rows =
    await getSql()`SELECT r.id,r.email,r.status,r.expires_at>now() AS live,m.name,t.name AS team_name,n.thread_ts FROM hive_join_request_notifications n JOIN hive_join_requests r ON r.id=n.request_id JOIN members m ON m.id=r.member_id JOIN teams t ON t.id=r.team_id WHERE r.team_id=${ctx.teamId} AND n.admin_member_id=${ctx.memberId} AND n.channel_id=${ctx.channelId} AND (n.thread_ts=${ctx.threadTs} OR (${topLevelDm} AND r.status='pending' AND r.expires_at>now() AND n.status='sent')) ORDER BY n.sent_at DESC NULLS LAST LIMIT 5`;
  return rows.map((row) => ({
    kind: "join_request",
    requestId: String(row.id),
    person: {
      name: row.name && row.name !== "Your Hive" ? String(row.name) : null,
      email: String(row.email),
    },
    team: String(row.team_name),
    status:
      row.status === "pending" && !row.live
        ? "expired"
        : (String(row.status) as SlackActionableNotice["status"]),
    noticeIsThisThread: row.thread_ts === ctx.threadTs,
  }));
}

async function findRequest(
  tx: postgres.TransactionSql,
  ctx: SlackToolContext,
  data: JoinDecisionInput,
): Promise<{ id: string; threadTs?: string }> {
  if (data.requestId) {
    const rows =
      await tx`SELECT r.id,n.thread_ts FROM hive_join_requests r LEFT JOIN hive_join_request_notifications n ON n.request_id=r.id AND n.admin_member_id=${ctx.memberId} AND n.channel_id=${ctx.channelId} WHERE r.team_id=${ctx.teamId} AND r.id=${data.requestId}`;
    if (!rows[0])
      throw new HiveError("There is no pending request for that person.", 409);
    const topLevel = ctx.threadTs === ctx.messageTs && rows[0].thread_ts;
    return {
      id: String(rows[0].id),
      ...(topLevel ? { threadTs: String(rows[0].thread_ts) } : {}),
    };
  }
  const person = data.person ? slackPlainText(data.person) : "";
  if (person) {
    const target = person.toLowerCase();
    const rows =
      await tx`SELECT r.id FROM hive_join_requests r JOIN members m ON m.id=r.member_id WHERE r.team_id=${ctx.teamId} AND r.status='pending' AND r.expires_at>now() AND (lower(m.name)=${target} OR lower(split_part(m.name,' ',1))=${target} OR r.email=${target} OR r.id=${target})`;
    if (rows.length !== 1)
      throw new HiveError(
        rows.length
          ? "More than one person matches. Use their email."
          : "There is no pending request for that person.",
        409,
      );
    return { id: String(rows[0].id) };
  }
  if (!ctx.channelId.startsWith("D")) throw new HiveError(askWho, 400);
  const exact =
    await tx`SELECT r.id FROM hive_join_request_notifications n JOIN hive_join_requests r ON r.id=n.request_id WHERE r.team_id=${ctx.teamId} AND n.admin_member_id=${ctx.memberId} AND n.channel_id=${ctx.channelId} AND n.thread_ts=${ctx.threadTs}`;
  if (exact[0]) return { id: String(exact[0].id) };
  const pending =
    await tx`SELECT r.id,n.thread_ts FROM hive_join_request_notifications n JOIN hive_join_requests r ON r.id=n.request_id WHERE r.team_id=${ctx.teamId} AND n.admin_member_id=${ctx.memberId} AND n.channel_id=${ctx.channelId} AND r.status='pending' AND r.expires_at>now() AND n.status='sent'`;
  if (pending.length === 1)
    return {
      id: String(pending[0].id),
      threadTs: String(pending[0].thread_ts),
    };
  throw new HiveError(
    pending.length ? askWho : "There is no pending request here.",
    409,
  );
}

export const joinRequestTools: SlackTool[] = [
  {
    name: "hive_decide_join_request",
    description:
      "Approve or decline a pending request to join this hive when an admin decides, in any wording: approve, approved, yes let them in, nope, decline this one. When threadContext.notices has the join request being answered, pass its requestId. Otherwise pass person as the name or email the admin gave. Omit both when the person is unclear; the server asks who. Acts immediately without confirmation. Never select for questions about a request.",
    input_schema: z.toJSONSchema(input) as SlackTool["input_schema"],
    async handler(ctx, args) {
      try {
        const data = input.parse(args);
        const judgment = await decideDecisiveness(ctx.instructionText ?? "", {
          ...ctx,
          actionType: "join_request",
        });
        if (!judgment.act)
          return {
            text: judgment.reason,
            ...(judgment.react ? { react: judgment.react } : {}),
          };
        const actor = await toolActor(ctx);
        let requestId: string | null = null;
        const result = await runReversibleAction(
          ctx,
          "hive_decide_join_request",
          async (tx) => {
            const target = await findRequest(tx, ctx, data);
            requestId = target.id;
            const changed = await decideJoinRequestInTransaction(
              tx,
              actor,
              target.id,
              data.decision,
            );
            return {
              inverse: {
                kind: "join_request_decided",
                id: target.id,
                version: changed.version,
              },
              threadTs: target.threadTs,
              text:
                data.decision === "approve"
                  ? "Join request approved."
                  : "Join request declined.",
              react: "white_check_mark",
            };
          },
        );
        if (data.decision === "decline" && requestId)
          await deliverJoinDecline(requestId);
        return result;
      } catch (error) {
        if (error instanceof HiveError) return { text: error.message };
        if (error instanceof z.ZodError)
          return { text: "Should I approve or decline this request?" };
        throw error;
      }
    },
  },
];
