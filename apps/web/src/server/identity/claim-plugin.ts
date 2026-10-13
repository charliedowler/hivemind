import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { claimWelcome } from "./welcome";
import { authAccess } from "../analytics/auth";

export const welcomeClaimPlugin = () => ({
  id: "hive-welcome-claim" as const,
  endpoints: {
    claim: createAuthEndpoint("/claim", { method: "GET" }, async ctx => {
      ctx.setHeader("Cache-Control", "no-store");
      ctx.setHeader("Referrer-Policy", "no-referrer");
      try {
        const token = typeof ctx.query?.token === "string" ? ctx.query.token : "";
        const claimed = await claimWelcome(token, ctx.headers?.get("user-agent"));
        await setSessionCookie(ctx, claimed);
        await authAccess({ memberId: claimed.user.id }, "email_verified", claimed.session.id);
      } catch (error) {
        throw ctx.redirect("/app/login?error=claim_expired");
      }
      throw ctx.redirect("/app");
    }),
  },
});
