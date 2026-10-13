import { z } from "zod";
import type { SlackTool, SlackToolContext, SlackToolResult } from "./index";
import { toolActor } from "./context";
import { undoThreadAction, isExplicitUndoIntent } from "./undo";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";
import { decideDecisiveness } from "@/server/slack/decisiveness";
import { runReversibleAction } from "@/server/slack/actions";
import {
  decideJoinRequestInTransaction,
  deliverJoinDecline,
} from "@/server/identity/join-requests";

const input = z.strictObject({
  decision: z.enum(["approve", "decline"]),
  person: z.string().max(200).optional(),
});
export function parseJoinDecision(text: string) {
  const clean = text
    .replace(/^(?:<@[A-Z0-9]+>\s*)+/, "")
    .replace(/\s+\*Sent using\* Slack MCP client\s*$/, "")
    .trim();
  const match = /^(?:please\s+)?(approve|decline)(?:\s+(.+?))?[.!?]*$/i.exec(
    clean,
  );
  return match
    ? {
        decision: match[1].toLowerCase() as "approve" | "decline",
        person: match[2]?.trim(),
      }
    : null;
}
async function findRequest(ctx: SlackToolContext, person?: string) {
  const sql = getSql();
  if (!person && ctx.channelId.startsWith("D")) {
    const exact =
      await sql`SELECT r.id FROM hive_join_request_notifications n JOIN hive_join_requests r ON r.id=n.request_id WHERE r.team_id=${ctx.teamId} AND n.admin_member_id=${ctx.memberId} AND n.channel_id=${ctx.channelId} AND n.thread_ts=${ctx.threadTs}`;
    if (exact[0]) return String(exact[0].id);
    const pending =
      await sql`SELECT r.id,n.thread_ts FROM hive_join_request_notifications n JOIN hive_join_requests r ON r.id=n.request_id WHERE r.team_id=${ctx.teamId} AND n.admin_member_id=${ctx.memberId} AND n.channel_id=${ctx.channelId} AND r.status='pending' AND r.expires_at>now() AND n.status='sent'`;
    if (pending.length === 1) {
      ctx.threadTs = String(pending[0].thread_ts);
      return String(pending[0].id);
    }
    throw new HiveError(
      pending.length
        ? "Who should I approve or decline? Include their name or email."
        : "There is no pending request here.",
      409,
    );
  }
  if (!person)
    throw new HiveError(
      "Who should I approve or decline? Include their name or email.",
      400,
    );
  const target = person.trim().toLowerCase();
  const rows =
    await sql`SELECT r.id FROM hive_join_requests r JOIN members m ON m.id=r.member_id WHERE r.team_id=${ctx.teamId} AND r.status='pending' AND r.expires_at>now() AND (lower(m.name)=${target} OR lower(split_part(m.name,' ',1))=${target} OR r.email=${target} OR r.id=${target})`;
  if (rows.length !== 1)
    throw new HiveError(
      rows.length
        ? "More than one person matches. Use their email."
        : "There is no pending request for that person.",
      409,
    );
  return String(rows[0].id);
}
export const joinRequestTools: SlackTool[] = [
  {
    name: "hive_decide_join_request",
    description:
      "Approve or decline a pending request to join this hive on a clear admin instruction. person is the name or email in the instruction; omit it only for approve/decline in the request DM. Act immediately without confirmation. Membership is granted only on approval.",
    input_schema: z.toJSONSchema(input) as SlackTool["input_schema"],
    async handler(ctx, args) {
      try {
        const data = input.parse(args);
        const explicit = parseJoinDecision(ctx.instructionText ?? "");
        if (
          explicit &&
          (explicit.decision !== data.decision ||
            (explicit.person &&
              explicit.person.toLowerCase() !== data.person?.toLowerCase()))
        )
          return {
            text: "Use approve or decline with the person’s name or email.",
          };
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
            requestId = await findRequest(ctx, data.person);
            const changed = await decideJoinRequestInTransaction(
              tx,
              actor,
              requestId,
              data.decision,
            );
            return {
              inverse: {
                kind: "join_request_decided",
                id: requestId,
                version: changed.version,
              },
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
          return {
            text: "Use approve or decline with the person’s name or email.",
          };
        throw error;
      }
    },
  },
];
export async function respondToJoinRequest(
  ctx: SlackToolContext,
  message: string,
  messageTs: string,
): Promise<SlackToolResult | null> {
  const instruction = { ...ctx, messageTs, instructionText: message };
  const explicit = parseJoinDecision(message);
  if (explicit) return joinRequestTools[0].handler(instruction, explicit);
  if (ctx.channelId.startsWith("D") && isExplicitUndoIntent(message)) {
    if (ctx.threadTs !== messageTs) return undoThreadAction(instruction);
    const latest =
      await getSql()`SELECT thread_ts FROM slack_tool_actions WHERE team_id=${ctx.teamId} AND member_id=${ctx.memberId} AND channel_id=${ctx.channelId} ORDER BY created_at DESC,id DESC LIMIT 1`;
    if (latest[0])
      return undoThreadAction({
        ...instruction,
        threadTs: String(latest[0].thread_ts),
      });
  }
  return null;
}
