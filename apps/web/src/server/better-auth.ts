import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { authAccess } from "./analytics/auth";
import { recordEvent } from "./analytics/events";
import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { enabledSignInProviders } from "@/lib/auth-providers";
import { publicUrl } from "@/lib/public-url";
import { getDb, getSql } from "./db/client";
import { members, webSessions } from "./db/schema";
import { authAccounts, authVerification, authRateLimit } from "./db/auth-schema";
import * as oauthSchema from "./db/oauth-schema";
import { hashToken, newId } from "./db/ids";
import { deliverCode } from "./identity/email";
import { rateLimit } from "./identity/rate-limit";
import { enrollMember, memberContext, registrationForStorage } from "./identity/enrollment";

export function createHiveAuth(baseUrl: string, delivery = deliverCode, resourceUrl = baseUrl) {
  const secret = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "hive-local-development-secret-change-before-deploy" : undefined);
  const socialProviders = Object.fromEntries(enabledSignInProviders().map((provider) => [provider, {
    clientId: process.env[`${provider.toUpperCase()}_CLIENT_ID`]!,
    clientSecret: process.env[`${provider.toUpperCase()}_CLIENT_SECRET`]!,
    requireEmailVerification: true,
  }]));
  return betterAuth({
    appName: "Hive",
    baseURL: baseUrl,
    secret,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      transaction: true,
      schema: { user: members, session: webSessions, account: authAccounts, verification: authVerification, rateLimit: authRateLimit, ...oauthSchema },
    }),
    advanced: { database: { generateId: ({ model }) => newId(model === "user" ? "mem" : "auth") } },
    user: {
      additionalFields: {
        teamId: { type: "string", required: false, input: false, returned: false },
        role: { type: "string", required: false, defaultValue: "member", input: false, returned: false },
        removedAt: { type: "date", required: false, input: false, returned: false },
        hiveRegistration: { type: "string", required: false, returned: false },
      },
    },
    session: {
      fields: { userId: "memberId" },
      expiresIn: 30 * 86400,
      cookieCache: { enabled: false },
      additionalFields: {
        teamId: { type: "string", required: false, input: false, returned: false },
        tokenHash: { type: "string", required: true, input: false, returned: false },
      },
    },
    emailAndPassword: { enabled: true, requireEmailVerification: true, revokeSessionsOnPasswordReset: true },
    emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: false },
    socialProviders,
    account: { accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    disabledPaths: ["/token", "/sign-in/email-otp", "/update-user", "/delete-user", "/change-email"],
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const result = ctx.context.returned;
        if (ctx.path === "/sign-in/email" && isAPIError(result)) {
          await recordEvent({ name: "access.changed", outcome: "login_failed", reasonCode: result.statusCode === 401 ? "invalid_credentials" : "access_denied", properties: { actorKind: "anonymous" } });
        }
        if (ctx.path === "/oauth2/consent" && ctx.body?.accept === true && !isAPIError(result) && ctx.context.session?.user && result && typeof result === "object" && "url" in result && typeof result.url === "string") {
          const granted = new URL(result.url).searchParams;
          if (granted.has("code") && !granted.has("error")) await authAccess({ memberId: ctx.context.session.user.id }, "mcp_oauth_authorized");
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            if (!user.name.trim() || user.name.length > 80) throw new APIError("BAD_REQUEST", { message: "Enter your name, up to 80 characters." });
            if (ctx?.path?.startsWith("/callback/") && !user.emailVerified) throw new APIError("FORBIDDEN", { message: "The provider must verify your email." });
            let registration: string | null;
            try { registration = registrationForStorage((user as Record<string, unknown>).hiveRegistration); }
            catch { throw new APIError("BAD_REQUEST", { message: "Choose a valid team or invite." }); }
            return { data: { ...user, email: user.email.trim().toLowerCase(), hiveRegistration: registration } };
          },
          after: async (user) => {
            if (user.emailVerified) {
              await enrollMember(user.id);
              await authAccess({ memberId: user.id }, "email_verified", user.id);
            }
          },
        },
        update: { after: async (user, ctx) => {
          if (user.emailVerified) {
            await enrollMember(user.id);
            if (ctx?.path === "/email-otp/verify-email" || ctx?.path === "/verify-email") await authAccess({ memberId: user.id }, "email_verified", user.id);
          }
        } },
      },
      session: { create: { before: async (session) => {
        const rows = await getSql()`SELECT team_id, removed_at FROM members WHERE id = ${session.userId}`;
        if (!rows[0] || rows[0].removed_at) throw new APIError("FORBIDDEN", { message: "This membership is no longer active." });
        return { data: { ...session, tokenHash: hashToken(session.token), teamId: rows[0].team_id } };
      }, after: async (session) => { await authAccess({ memberId: session.userId }, "login", session.id); } },
        delete: { after: async (session, ctx) => {
          if (ctx?.path === "/sign-out") await authAccess({ memberId: session.userId }, "logout", session.id);
        } },
      },
    },
    plugins: [
      emailOTP({
        expiresIn: 900,
        allowedAttempts: 5,
        storeOTP: "hashed",
        overrideDefaultEmailVerification: true,
        disableSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          await rateLimit("better-auth-email", email, 5, 3600);
          if (!await delivery(email, otp, newId(type))) throw new APIError("BAD_GATEWAY", { message: "Your email code could not be sent. Try again later." });
          if (type === "email-verification") await authAccess({ email }, "email_verification_sent");
        },
      }),
      jwt(),
      mcp({
        loginPage: "/app/login",
        consentPage: "/app/consent",
        resource: `${resourceUrl}/api/mcp`,
        scopes: ["openid", "profile", "email", "offline_access", "hive"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        grantTypes: ["authorization_code", "refresh_token"],
        postLogin: {
          page: "/app/join",
          shouldRedirect: async ({ user }) => !await memberContext(user.id),
          consentReferenceId: async ({ user }) => (await memberContext(user.id))?.teamId,
        },
        customAccessTokenClaims: async ({ user, referenceId }) => {
          if (!user) throw new APIError("FORBIDDEN", { message: "A hive member must sign in." });
          const ctx = await memberContext(user.id, referenceId);
          if (!ctx) throw new APIError("FORBIDDEN", { message: "Join a hive before connecting your forager." });
          return { hive_member_id: ctx.memberId, hive_team_id: ctx.teamId };
        },
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ],
  });
}

let instance: ReturnType<typeof createHiveAuth> | undefined;
export async function getAuth() {
  if (!instance) {
    const resourceUrl = await publicUrl();
    instance = createHiveAuth((process.env.BETTER_AUTH_URL || resourceUrl).replace(/\/+$/, ""), deliverCode, resourceUrl);
  }
  return instance;
}

export function mcpResource(auth: ReturnType<typeof createHiveAuth>) {
  const resource = auth.options.plugins.find((plugin) => plugin.id === "oauth-provider")?.options.resources?.[0];
  if (!resource) throw new Error("The hive MCP resource is not configured.");
  return typeof resource === "string" ? resource : resource.identifier;
}
