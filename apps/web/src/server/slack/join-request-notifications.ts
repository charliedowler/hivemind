import { createHash } from "node:crypto";
import { getSql } from "../db/client";
import { installation } from "./install";
import { slackCall, SlackRateLimit } from "./client";
import { slackEscape } from "./format";

export async function notifyJoinRequestAdmins(requestId: string) {
  const sql = getSql();
  const requests =
    await sql`SELECT r.team_id,r.email,m.name,t.name AS team_name FROM hive_join_requests r JOIN members m ON m.id=r.member_id JOIN teams t ON t.id=r.team_id WHERE r.id=${requestId} AND r.status='pending' AND r.expires_at>now()`;
  if (!requests[0]) return;
  const request = requests[0];
  let inst;
  try {
    inst = await installation(String(request.team_id));
  } catch {
    return;
  }
  const admins =
    await sql`SELECT n.admin_member_id,m.email,l.slack_user_id FROM hive_join_request_notifications n JOIN members m ON m.id=n.admin_member_id JOIN hive_memberships h ON h.member_id=m.id AND h.team_id=${request.team_id} LEFT JOIN slack_actor_links l ON l.member_id=m.id AND l.team_id=h.team_id WHERE n.request_id=${requestId} AND n.status='pending' AND h.role='admin' AND h.removed_at IS NULL AND m.actor_type='human' AND m.email_verified AND NOT m.provisional AND m.disabled_at IS NULL`;
  for (const admin of admins) {
    let userId = admin.slack_user_id;
    if (!userId) {
      try {
        const lookup = await slackCall(inst.token, "users.lookupByEmail", {
          email: String(admin.email),
        });
        const user = lookup.user as {
          id?: string;
          deleted?: boolean;
          is_bot?: boolean;
        };
        if (!user?.id || user.deleted || user.is_bot) continue;
        userId = user.id;
      } catch {
        continue;
      }
    }
    const claimed =
      await sql`UPDATE hive_join_request_notifications SET status='sending' WHERE request_id=${requestId} AND admin_member_id=${admin.admin_member_id} AND status='pending' RETURNING request_id`;
    if (!claimed.length) continue;
    try {
      const digest = createHash("sha256")
        .update(`${requestId}:${admin.admin_member_id}`)
        .digest("hex");
      const clientId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const sent = await slackCall(inst.token, "chat.postMessage", {
        channel: String(userId),
        text: `${request.name && request.name !== "Your Hive" ? `${slackEscape(String(request.name))} (${slackEscape(String(request.email))})` : slackEscape(String(request.email))} asked to join ${slackEscape(String(request.team_name))}. Reply approve or decline.`,
        client_msg_id: clientId,
        parse: "none",
        unfurl_links: false,
        unfurl_media: false,
      });
      if (typeof sent.channel !== "string" || typeof sent.ts !== "string")
        throw new Error("Slack message receipt missing");
      await sql`UPDATE hive_join_request_notifications SET status='sent',channel_id=${sent.channel},thread_ts=${sent.ts},sent_at=now() WHERE request_id=${requestId} AND admin_member_id=${admin.admin_member_id}`;
    } catch (error) {
      const retryable = error instanceof SlackRateLimit;
      await sql`UPDATE hive_join_request_notifications SET status=${retryable ? "pending" : "uncertain"} WHERE request_id=${requestId} AND admin_member_id=${admin.admin_member_id}`;
      console.warn(
        JSON.stringify({
          event: "join_request_dm",
          status: retryable ? "retry" : "uncertain",
        }),
      );
    }
  }
}
