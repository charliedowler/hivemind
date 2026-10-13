import { createAuthMiddleware, getOAuthState, isAPIError } from "better-auth/api";
import { authAccess } from "./analytics/auth";
import { recordEvent } from "./analytics/events";
import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, genericOAuth, jwt } from "better-auth/plugins";
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
import { agentClaims, isAgentMember, storeAgentOwner } from "./identity/agent-enrollment";
import { agentidProvider } from "./identity/agentid-provider";
import { welcomeClaimPlugin } from "./identity/claim-plugin";

export function createHiveAuth(baseUrl: string, delivery = deliverCode, resourceUrl = baseUrl) {
  const secret = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "hive-local-development-secret-change-before-deploy" : undefined);
  const socialProviders = Object.fromEntries(enabledSignInProviders().filter(provider => provider !== "agentid").map((provider) => [provider, {
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
        if (provider === "agentid") {
          const claims = agentClaims.safeParse(source.oauth?.profile);
          if (!claims.success) return { error: "invalid_agent_identity", errorDescription: "AgentID must verify this agent." };
          if (process.env.AGENTID_CLIENT_SECRET && (!claims.data.owner_sub || !claims.data.owner_email || claims.data.owner_email_verified !== true)) return { error: "owner_not_verified", errorDescription: "AgentID must verify the owner email." };
          if (rows.length) {
            const accounts = await getSql()`SELECT user_id FROM auth_accounts WHERE provider_id = 'agentid' AND account_id = ${claims.data.sub}`;
            if (!accounts[0] || rows.some(row => row.id !== accounts[0].user_id || row.actor_type !== "agent")) return { error: "agent_account_conflict", errorDescription: "This inbox belongs to a different identity. Use a separate agent inbox." };
          }
        } else {
          if (rows.some(row => row.actor_type === "agent")) return { error: "agentid_required", errorDescription: "Sign in as an agent with AgentID." };
          if (source.action === "link-account" && rows.some(row => !row.email_verified && !row.provisional)) return { error: "account_not_linked", errorDescription: "Verify the existing human account before linking another sign-in." };
          if (rows.some(row => row.provisional)) {
            const passwords = await getSql()`SELECT id FROM auth_accounts WHERE user_id IN ${getSql()(rows.map(row => String(row.id)))} AND password IS NOT NULL`;
            if (passwords.length) return { error: "account_not_linked", errorDescription: "Sign in with the existing human account." };
          }
          if (rows.some(row => row.provisional) && (!user.emailVerified || !source.oauth || !["google", "slack"].includes(provider ?? ""))) return { error: "human_proof_required", errorDescription: "Verify this email with a human sign-in provider." };
        }
      },
      additionalFields: {
        actorType: { type: "string", required: false, defaultValue: "human", input: false, returned: false },
        teamId: { type: "string", required: false, input: false, returned: false },
        role: { type: "string", required: false, defaultValue: "member", input: false, returned: false },
        provisional: { type: "boolean", required: false, defaultValue: false, input: false, returned: false },
        disabledAt: { type: "date", required: false, input: false, returned: false },
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
    account: { accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false, requireLocalEmailVerified: false } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    disabledPaths: ["/token", "/sign-in/email-otp", "/update-user", "/delete-user", "/change-email"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if ((ctx.path === "/link-social" || ctx.path === "/unlink-account" || ctx.path === "/change-password" || ctx.path === "/set-password") && ctx.context.session?.user && await isAgentMember(ctx.context.session.user.id)) throw new APIError("FORBIDDEN", { message: "Agents sign in only with AgentID." });
      }),
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
            const agent = Boolean(ctx?.path?.startsWith("/callback/") && (ctx.params?.id === "agentid" || ctx.path.endsWith("/agentid")));
            if (agent) {
              const state = await getOAuthState<{ hiveRegistration?: unknown }>();
              if (state?.hiveRegistration) registration = registrationForStorage(state.hiveRegistration);
            }
            return { data: { ...user, actorType: agent ? "agent" : "human", email: user.email.trim().toLowerCase(), hiveRegistration: registration } };
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
      account: {
        create: {
          before: async (account) => {
            if (account.providerId !== "agentid" && await isAgentMember(account.userId)) throw new APIError("FORBIDDEN", { message: "Agent and human accounts stay separate." });
            return { data: account };
          },
          after: async (account) => { await storeAgentOwner(account); },
        },
        update: { after: async (account) => {
          if (account.providerId === "agentid") {
            const state = await getOAuthState<{ hiveRegistration?: unknown }>();
            if (state?.hiveRegistration) await getSql()`UPDATE members SET hive_registration = ${registrationForStorage(state.hiveRegistration)} WHERE id = ${account.userId} AND actor_type = 'agent'`;
          }
          await storeAgentOwner(account);
        } },
      },
      session: { create: { before: async (session) => {
        const rows = await getSql()`SELECT disabled_at, provisional FROM members WHERE id = ${session.userId}`;
        if (!rows[0] || rows[0].disabled_at || rows[0].provisional) throw new APIError("FORBIDDEN", { message: "This membership is no longer active." });
        return { data: { ...session, tokenHash: hashToken(session.token), teamId: (await memberContext(session.userId))?.teamId ?? null } };
      }, after: async (session) => { await authAccess({ memberId: session.userId }, "login", session.id); } },
        delete: { after: async (session, ctx) => {
          if (ctx?.path === "/sign-out") await authAccess({ memberId: session.userId }, "logout", session.id);
        } },
      },
    },
    plugins: [
      welcomeClaimPlugin(),
      ...(enabledSignInProviders().includes("agentid") ? [genericOAuth({ config: [agentidProvider()] })] : []),
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
          if (!ctx) throw new APIError("FORBIDDEN", { message: "Join a hive before connecting your agent." });
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
