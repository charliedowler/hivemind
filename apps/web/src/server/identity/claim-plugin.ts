import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { claimWelcome } from "./welcome";
import { getSql } from "../db/client";
import { signInMemberContext } from "./session-context";
import { authAccess } from "../analytics/auth";

export const welcomeClaimPlugin = () => ({
  id: "hive-welcome-claim" as const,
  endpoints: {
    claim: createAuthEndpoint("/claim", { method: "GET" }, async ctx => {
      ctx.setHeader("Cache-Control", "no-store");
      ctx.setHeader("Referrer-Policy", "no-referrer");
      let agentClaim = false;
      try {
        const token = typeof ctx.query?.token === "string" ? ctx.query.token : "";
        const claimed = await claimWelcome(token, ctx.headers?.get("user-agent"));
        const selected = await signInMemberContext(claimed.user.id, claimed.session.id);
        if (selected) await getSql()`UPDATE web_sessions SET team_id = ${selected.teamId} WHERE id = ${claimed.session.id}`;
        agentClaim = claimed.agentClaim;
        await setSessionCookie(ctx, claimed);
        await authAccess({ memberId: claimed.user.id }, "email_verified", claimed.session.id);
      } catch (error) {
        throw ctx.redirect("/app/login?error=claim_expired");
      }
      throw ctx.redirect(agentClaim ? "/app/claimed" : "/app");
    }),
  },
});
