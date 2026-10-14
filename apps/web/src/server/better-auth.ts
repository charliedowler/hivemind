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
import { enrollMember, memberContext, personalMemberContext, registrationForStorage } from "./identity/enrollment";
import { isAgentMember } from "./identity/agent-enrollment";
import { welcomeClaimPlugin } from "./identity/claim-plugin";
import { credentialVersion, credentialEpoch, personScope } from "./identity/credential-scope";
import { enrollSessionContext, signInMemberContext } from "./identity/session-context";

export function createHiveAuth(baseUrl: string, delivery = deliverCode, resourceUrl = baseUrl) {
  const secret = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "hive-local-development-secret-change-before-deploy" : undefined);
  const socialProviders = Object.fromEntries(enabledSignInProviders().map((provider) => [provider, {
    clientId: process.env[`${provider.toUpperCase()}_CLIENT_ID`]!,
    clientSecret: process.env[`${provider.toUpperCase()}_CLIENT_SECRET`]!,
    requireEmailVerification: true,
  }]));
  return betterAuth({
    appName: "Hive",
    onAPIError: { errorURL: "/app/auth-error" },
    baseURL: baseUrl,
    secret,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      transaction: true,
      schema: { user: members, session: webSessions, account: authAccounts, verification: authVerification, rateLimit: authRateLimit, ...oauthSchema },
    }),
    advanced: { database: { generateId: ({ model }) => newId(model === "user" ? "mem" : "auth") } },
    user: {
      validateUserInfo: async ({ user, source }) => {
        const provider = source.oauth?.providerId;
        const rows = await getSql()`SELECT m.id, m.actor_type, m.provisional, m.email_verified FROM members m WHERE m.id = ${user.id ?? ""} OR lower(m.email) = ${(user.email ?? "").toLowerCase()}`;
        if (rows.some(row => row.actor_type === "agent")) return { error: "agent_credentials_required", errorDescription: "Agents connect with Hive credentials." };
        if (source.action === "link-account" && rows.some(row => !row.email_verified && !row.provisional)) return { error: "account_not_linked", errorDescription: "Verify the existing human account before linking another sign-in." };
        if (rows.some(row => row.provisional)) {
          const passwords = await getSql()`SELECT id FROM auth_accounts WHERE user_id IN ${getSql()(rows.map(row => String(row.id)))} AND password IS NOT NULL`;
          if (passwords.length) return { error: "account_not_linked", errorDescription: "Sign in with the existing human account." };
        }
        if (rows.some(row => row.provisional) && (!user.emailVerified || !source.oauth || !["google", "slack"].includes(provider ?? ""))) return { error: "human_proof_required", errorDescription: "Verify this email with a human sign-in provider." };
      },
      additionalFields: {
        actorType: { type: "string", required: false, defaultValue: "human", input: false, returned: false },
        provisional: { type: "boolean", required: false, defaultValue: false, input: false, returned: false },
        disabledAt: { type: "date", required: false, input: false, returned: false },
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
    account: { accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false, requireLocalEmailVerified: false, updateUserInfoOnLink: true } },
    // Public discovery documents and the signing keys are static and served to every MCP client and crawler; a
    // database-backed counter cost two queries per hit. Sign-in and token endpoints keep the database limit.
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60, customRules: { "/.well-known/**": false, "/jwks": false } },
    disabledPaths: ["/token", "/sign-in/email-otp", "/update-user", "/delete-user", "/change-email"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if ((ctx.path === "/link-social" || ctx.path === "/unlink-account" || ctx.path === "/change-password" || ctx.path === "/set-password") && ctx.context.session?.user && await isAgentMember(ctx.context.session.user.id)) throw new APIError("FORBIDDEN", { message: "Agents connect with Hive credentials." });
      }),
      after: createAuthMiddleware(async (ctx) => {
        const result = ctx.context.returned;
        if (ctx.path === "/sign-in/email" && isAPIError(result)) {
          await recordEvent({ name: "access.changed", outcome: "login_failed", reasonCode: result.statusCode === 401 ? "invalid_credentials" : "access_denied", properties: { actorKind: "anonymous" } });
        }
        if (ctx.path === "/oauth2/consent" && ctx.body?.accept === true && !isAPIError(result) && ctx.context.session?.user && result && typeof result === "object" && "url" in result && typeof result.url === "string") {
          const granted = new URL(result.url, baseUrl).searchParams;
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
            return { data: { ...user, actorType: "human", email: user.email.trim().toLowerCase(), hiveRegistration: registration } };
          },
          after: async (user) => {
            if (user.emailVerified && !await isAgentMember(user.id)) {
              await enrollMember(user.id);
              await authAccess({ memberId: user.id }, "email_verified", user.id);
            }
          },
        },
        update: { after: async (user, ctx) => {
          if (user.emailVerified && !await isAgentMember(user.id)) {
            await enrollMember(user.id);
            if (ctx?.path === "/email-otp/verify-email" || ctx?.path === "/verify-email") await authAccess({ memberId: user.id }, "email_verified", user.id);
          }
        } },
      },
      account: { create: { before: async (account) => {
        if (await isAgentMember(account.userId)) throw new APIError("FORBIDDEN", { message: "Agent and human accounts stay separate." });
        return { data: account };
      } } },
      session: { create: { before: async (session) => {
        const rows = await getSql()`SELECT disabled_at, provisional FROM members WHERE id = ${session.userId}`;
        if (!rows[0] || rows[0].disabled_at || rows[0].provisional) throw new APIError("FORBIDDEN", { message: "This membership is no longer active." });
        return { data: { ...session, tokenHash: hashToken(session.token), teamId: (await signInMemberContext(session.userId, session.id))?.teamId ?? null } };
      }, after: async (session) => { await signInMemberContext(session.userId, session.id); await authAccess({ memberId: session.userId }, "login", session.id); } },
        delete: { after: async (session, ctx) => {
          if (ctx?.path === "/sign-out") await authAccess({ memberId: session.userId }, "logout", session.id);
        } },
      },
    },
    plugins: [
      welcomeClaimPlugin(),
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
        // The resource row is seeded from this config and never edited at runtime, so token and registration
        // requests read it from memory instead of auth_oauth_resource.
        cachedResources: new Set([`${resourceUrl}/api/mcp`]),
        scopes: ["openid", "profile", "email", "offline_access", "hive", personScope],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        grantTypes: ["authorization_code", "refresh_token"],
        postLogin: {
          page: "/app/join",
          shouldRedirect: async ({ user, session }) => !await enrollSessionContext(user.id, session.id),
          consentReferenceId: async ({ user, session, scopes }) => {
            const selected = await enrollSessionContext(user.id, session.id);
            return (scopes.includes(personScope) ? await personalMemberContext(user.id) : selected)?.teamId;
          },
        },
        customAccessTokenClaims: async ({ user, referenceId, scopes }) => {
          if (!user) throw new APIError("FORBIDDEN", { message: "A hive member must sign in." });
          const ctx = scopes.includes(personScope) ? await personalMemberContext(user.id) : await memberContext(user.id, referenceId);
          if (!ctx) throw new APIError("FORBIDDEN", { message: "Join a hive before connecting your agent." });
          if (ctx.teamId !== referenceId) throw new APIError("FORBIDDEN", { message: "Sign in again to grant the requested hive access." });
          return { hive_member_id: ctx.memberId, hive_team_id: ctx.teamId, hive_access: scopes.includes(personScope) ? "person" : "team", hive_credential_version: credentialVersion, hive_credential_epoch: await credentialEpoch() };
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
