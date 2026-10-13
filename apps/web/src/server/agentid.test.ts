import { createHash, randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHiveAuth } from "./better-auth";
import { getSql } from "./db/client";
import { hashToken, newId } from "./db/ids";
import { enrollMember } from "./identity/enrollment";
import { agentEnrollmentNotice, enrollAgent, ownerJoinDecision, ownerTeams, storeAgentOwner } from "./identity/agent-enrollment";
import { requireAdmin, revokeKey } from "./identity/access";
import { issueApiKey } from "./auth";
import { canJoinByDomain, isPublicDomain } from "./identity/email-domain";
import { enabledSignInProviders } from "@/lib/auth-providers";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { GET as startAgentSignIn } from "@/app/api/auth/agentid/start/route";
import { contextFromClaims } from "./bearer-auth";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ auth: undefined as ReturnType<typeof createHiveAuth> | undefined }));
vi.mock("./better-auth", async original => ({ ...await original<typeof import("./better-auth")>(), getAuth: async () => fixture.auth! }));
vi.mock("./llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("./llm/tagger", () => ({ suggestTags: async () => [] }));

it("chooses one owner team immediately and asks only for several", () => {
  expect(ownerJoinDecision([]).kind).toBe("onboard");
  expect(ownerJoinDecision([{ id: "a", name: "A" }])).toEqual({ kind: "join", team: { id: "a", name: "A" } });
  expect(ownerJoinDecision([{ id: "a", name: "A" }, { id: "b", name: "B" }]).kind).toBe("choose");
});
it("hides AgentID without both values and blocks agent domains and custom-domain agents", () => {
  expect(enabledSignInProviders({ AGENTID_CLIENT_ID: "fixture" })).not.toContain("agentid");
  expect(enabledSignInProviders({ AGENTID_CLIENT_ID: "fixture", AGENTID_CLIENT_SECRET: "fixture" })).toEqual(["agentid"]);
  for (const domain of ["agentmail.to", "agentmail.cc", "org.agentmail.to"]) expect(isPublicDomain(domain)).toBe(true);
  expect(canJoinByDomain("agent@company.test", "agent")).toBe(false);
  expect(canJoinByDomain("human@company.test", "human")).toBe(true);
});

describe.skipIf(!process.env.DATABASE_URL)("AgentID callback and enrollment", () => {
  const suffix = randomBytes(8).toString("hex");
  const baseUrl = "http://localhost:3000";
  const teamIds: string[] = [];
  const memberIds: string[] = [];
  let auth: ReturnType<typeof createHiveAuth>;
  let claims: Record<string, unknown>;
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let publicKey: Record<string, unknown>;
  let agentId: string;
  let agentCookie: string;
  let ownerId: string;
  let ownerTeam: string;
  let otherTeam: string;
  let oauthClient: string;
  const harnessClients: string[] = [];
  const originalFetch = globalThis.fetch;
  const sentInvites: Record<string, unknown>[] = [];

  async function request(path: string, body?: unknown, cookie = "") {
    return auth.handler(new Request(`${baseUrl}${path}`, { method: body ? "POST" : "GET", headers: { Origin: baseUrl, "x-forwarded-for": `198.18.${parseInt(suffix.slice(0, 2), 16)}.${Math.floor(Math.random() * 250)}`, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  }
  async function signIn(profile: Record<string, unknown>, invite?: string) {
    claims = profile;
    const start = await request("/api/auth/sign-in/social", { provider: "agentid", callbackURL: "/app/join", loginHint: profile.email, additionalData: invite ? { hiveRegistration: { intent: "invite", inviteCode: invite } } : undefined });
    expect(start.status, await start.clone().text()).toBe(200);
    const authorization = new URL((await start.json()).url);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("scope")?.split(" ")).toEqual(["openid", "email", "profile", "owner_profile", "owner_email"]);
    expect(authorization.searchParams.get("login_hint")).toBe(profile.email);
    const cookie = start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const callback = await request(`/api/auth/callback/agentid?code=fixture&state=${authorization.searchParams.get("state")}&iss=https%3A%2F%2Fauth.agentid.com`, undefined, cookie);
    expect(callback.status, await callback.clone().text()).toBe(302);
    const location = callback.headers.get("location") ?? "";
    const sessionCookie = callback.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    return { callback, location, cookie: sessionCookie };
  }
  function profile(label: string, ownerEmail?: string) {
    return { sub: `${label}-${suffix}`, email: `${label}-${suffix}@agentmail.to`, email_verified: true, emailVerified: true, actor_type: "agent", name: label, ...(ownerEmail ? { owner_sub: `owner-${ownerEmail}-${suffix}`, owner_name: "Owner fixture", owner_email: ownerEmail, owner_email_verified: true } : {}) };
  }
  beforeAll(async () => {
    vi.stubEnv("AGENTID_CLIENT_ID", "agentid-fixture");
    vi.stubEnv("AGENTID_CLIENT_SECRET", "agentid-fixture-secret");
    vi.stubEnv("BETTER_AUTH_SECRET", "fixture-secret-with-at-least-thirty-two-characters");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("SLACK_CLIENT_ID", "");
    vi.stubEnv("PUBLIC_URL", baseUrl);
    vi.stubEnv("RESEND_API_KEY", "fixture");
    vi.stubEnv("EMAIL_FROM", "Hive <fixture@example.test>");
    const pair = await generateKeyPair("ES256");
    signingKey = pair.privateKey;
    publicKey = { ...await exportJWK(pair.publicKey), kid: `agentid-${suffix}`, alg: "ES256", use: "sig" };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("auth.agentid.com/.well-known/openid-configuration")) return Response.json({ issuer: "https://auth.agentid.com", authorization_endpoint: "https://auth.agentid.com/v0/authorize", token_endpoint: "https://auth.agentid.com/v0/token", userinfo_endpoint: "https://auth.agentid.com/v0/userinfo", jwks_uri: "https://auth.agentid.com/v0/jwks.json", response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["ES256"], token_endpoint_auth_methods_supported: ["client_secret_basic"] });
      if (url.endsWith("/v0/jwks.json")) return Response.json({ keys: [publicKey] });
      if (url.endsWith("/v0/token")) {
        const token = await new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: String(publicKey.kid) }).setIssuer("https://auth.agentid.com").setAudience("agentid-fixture").setIssuedAt().setExpirationTime("10m").sign(signingKey);
        return Response.json({ id_token: token, access_token: "fixture-agent-token", token_type: "Bearer", expires_in: 600 });
      }
      if (url.endsWith("/v0/userinfo")) {
        const { actor_type: _actorType, ...userinfo } = claims;
        return Response.json(userinfo);
      }
      if (url === "https://api.resend.com/emails") { sentInvites.push(JSON.parse(String(init?.body))); return Response.json({ id: "fixture-delivery" }); }
      if (url === `${baseUrl}/api/auth/jwks`) return auth.handler(new Request(url));
      return originalFetch(input, init);
    });
    auth = createHiveAuth(baseUrl, async () => true);
    fixture.auth = auth;
    const sql = getSql();
    ownerTeam = newId("team"); otherTeam = newId("team");
    teamIds.push(ownerTeam, otherTeam);
    for (const id of teamIds) await sql`INSERT INTO teams (id, name, invite_code) VALUES (${id}, ${id === ownerTeam ? "Owner team" : "Other team"}, ${hashToken(id)})`;
    ownerId = newId("mem"); memberIds.push(ownerId);
    await sql`INSERT INTO members (id, team_id, name, email, email_verified, role) VALUES (${ownerId}, ${ownerTeam}, 'Owner fixture', ${`owner-${suffix}@company.test`}, true, 'admin')`;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    const sql = getSql();
    if (oauthClient) await sql`DELETE FROM auth_oauth_client WHERE client_id = ${oauthClient}`;
    if (harnessClients.length) await sql`DELETE FROM auth_oauth_client WHERE client_id IN ${sql(harnessClients)}`;
    for (const row of await sql`SELECT id FROM members WHERE email LIKE ${`%${suffix}%`}`) if (!memberIds.includes(row.id)) memberIds.push(row.id);
    await sql`DELETE FROM capture_rules WHERE team_id IN ${sql(teamIds)}`;
    await sql`DELETE FROM web_sessions WHERE member_id IN ${sql(memberIds)}`;
    await sql`DELETE FROM members WHERE id IN ${sql(memberIds)}`;
    await sql`DELETE FROM teams WHERE id IN ${sql(teamIds)}`;
  });
  it("creates a distinct agent, stores verified owner claims and joins one owner team", async () => {
    const result = await signIn(profile("agent", `owner-${suffix}@company.test`));
    expect(result.location).toBe("/app/join");
    agentCookie = result.cookie;
    const rows = await getSql()`SELECT m.*, a.account_id, a.owner_name FROM members m JOIN auth_accounts a ON a.user_id = m.id WHERE a.provider_id = 'agentid' AND a.account_id = ${`agent-${suffix}`}`;
    expect(rows[0]).toMatchObject({ actor_type: "agent", role: "member", team_id: ownerTeam, owner_name: "Owner fixture" });
    agentId = rows[0].id; memberIds.push(agentId);
    expect(agentId).not.toBe(ownerId);
    expect(await agentEnrollmentNotice(agentId)).toBe("You're in Owner team, joined via Owner fixture.");
    const again = await signIn(profile("agent", `owner-${suffix}@company.test`));
    expect(again.location).toBe("/app/join");
    expect((await getSql()`SELECT id FROM auth_accounts WHERE provider_id = 'agentid' AND account_id = ${`agent-${suffix}`}`)).toHaveLength(1);
  });
  it("forwards the initiate-login hint and preserves the state cookies", async () => {
    const response = await startAgentSignIn(new Request(`${baseUrl}/api/auth/agentid/start?login_hint=fixture%40agentmail.to`));
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).searchParams.get("login_hint")).toBe("fixture@agentmail.to");
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });
  it("joins the eighth agent through the same owner rule without a member or owner cap", async () => {
    for (let index = 1; index <= 8; index++) {
      const result = await signIn(profile(`fleet-${index}`, `owner-${suffix}@company.test`));
      expect(result.location).toBe("/app/join");
      const rows = await getSql()`SELECT id, role, team_id FROM members WHERE email = ${`fleet-${index}-${suffix}@agentmail.to`}`;
      memberIds.push(rows[0].id);
      expect(rows[0]).toMatchObject({ role: "member", team_id: ownerTeam });
    }
  });
  it("refuses an email collision with a human and a new subject reusing an agent inbox", async () => {
    const humanCollision = await signIn({ ...profile("collision", `owner-${suffix}@company.test`), email: `owner-${suffix}@company.test` });
    expect(humanCollision.location).toContain("agent_account_conflict");
    const reused = await signIn({ ...profile("new-agent", `owner-${suffix}@company.test`), email: `agent-${suffix}@agentmail.to` });
    expect(reused.location).toContain("agent_account_conflict");
  });
  it("honours an explicit invite before an owner team and never grants admin", async () => {
    const code = `hive-${suffix}`;
    await getSql()`UPDATE teams SET invite_code = ${hashToken(code)} WHERE id = ${otherTeam}`;
    const result = await signIn(profile("invited", `owner-${suffix}@company.test`), code);
    expect(result.location).toBe("/app/join");
    const rows = await getSql()`SELECT id, team_id, role FROM members WHERE email = ${`invited-${suffix}@agentmail.to`}`;
    memberIds.push(rows[0].id);
    expect(rows[0]).toMatchObject({ team_id: otherTeam, role: "member" });
  });
  it("rejects other teams and fails closed for disabled or unverified owners", async () => {
    await getSql()`UPDATE members SET disabled_at = now() WHERE id = ${ownerId}`;
    const result = await signIn(profile("choices", `owner-${suffix}@company.test`));
    expect(result.location).toContain("unable_to_create_user");
    expect(await ownerTeams(agentId)).toHaveLength(0);
    await expect(enrollAgent(agentId, undefined, "team_not_owned")).rejects.toThrow(/not a member/);
    await getSql()`UPDATE members SET disabled_at = NULL WHERE id = ${ownerId}`;
    expect(await ownerTeams(agentId)).toHaveLength(1);
    await getSql()`UPDATE members SET email_verified = false WHERE id = ${ownerId}`;
    expect(await ownerTeams(agentId)).toHaveLength(0);
    await getSql()`UPDATE members SET email_verified = true WHERE id = ${ownerId}`;
    expect((await enrollAgent(agentId, undefined, ownerTeam))?.teamId).toBe(ownerTeam);
  });
  it("rejects unverified owner claims and blocks agent management and domain joins", async () => {
    const nonAgent = await signIn({ ...profile("wrong-actor", `owner-${suffix}@company.test`), actor_type: "human" });
    expect(nonAgent.location).toContain("invalid_agent_identity");
    const result = await signIn({ ...profile("unverified", `owner-${suffix}@company.test`), owner_email_verified: false });
    expect(result.location).toContain("owner_not_verified");
    const ctx = (await enrollAgent(agentId))!;
    await expect(requireAdmin(ctx)).rejects.toThrow(/human/);
    await expect(issueApiKey(ctx)).rejects.toThrow(/human/);
    await expect(revokeKey(ctx, "key_any")).rejects.toThrow(/human/);
    await expect(getSql()`UPDATE members SET role = 'admin' WHERE id = ${agentId}`).rejects.toMatchObject({ code: "23514" });
    await expect(storeAgentOwner({ id: "wrong", userId: agentId, providerId: "agentid", accountId: "wrong", accessToken: "fixture" })).rejects.toThrow();
  });
  it("provisions a personal hive and refuses agent-created organisations", async () => {
    const result = await signIn(profile("creator", `new-owner-${suffix}@company.test`));
    expect(result.location).toBe("/app/join");
    const rows = await getSql()`SELECT id, team_id FROM members WHERE email = ${`creator-${suffix}@agentmail.to`}`;
    const id = rows[0].id; memberIds.push(id);
    const human = (await getSql()`SELECT id, email_verified, provisional FROM members WHERE email = ${`new-owner-${suffix}@company.test`}`)[0];
    memberIds.push(human.id);
    expect(human).toMatchObject({ email_verified: false, provisional: true });
    expect((await getSql()`SELECT personal_owner_member_id FROM teams WHERE id = ${rows[0].team_id}`)[0].personal_owner_member_id).toBe(human.id);
    await expect(enrollMember(id, { intent: "domain" })).rejects.toThrow(/Agents join/);
    await expect(enrollMember(id, { intent: "create", teamName: "Agent created team" })).rejects.toThrow(/human/);
    expect(sentInvites).toHaveLength(0);
    expect((await getSql()`SELECT role FROM hive_memberships WHERE member_id = ${id}`)[0].role).toBe("member");
    expect(await agentEnrollmentNotice(id)).toContain("Owner fixture");
  });
  it("fails closed when the same verified owner subject changes its email", async () => {
    const result = await signIn({ ...profile("changed-owner", `changed-${suffix}@company.test`), owner_sub: `owner-owner-${suffix}@company.test-${suffix}` });
    expect(result.location).toContain("unable_to_create_user");
    expect((await getSql()`SELECT email, email_verified FROM members WHERE id = ${ownerId}`)[0]).toMatchObject({ email: `owner-${suffix}@company.test`, email_verified: true });
  });
  it("uses the agent session through MCP consent, PKCE and a hive_search tool call", async () => {
    const registration = await request("/api/auth/oauth2/register", { client_name: "Agent forager", application_type: "native", redirect_uris: [`${baseUrl}/callback`], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"], scope: "hive" });
    expect(registration.status, await registration.clone().text()).toBe(201);
    oauthClient = (await registration.json()).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({ client_id: oauthClient, redirect_uri: `${baseUrl}/callback`, response_type: "code", scope: "hive", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "fixture", resource: `${baseUrl}/api/mcp` });
    const loggedOut = await request(`/api/auth/oauth2/authorize?${params}`);
    expect(loggedOut.headers.get("location")).toContain("/app/login");
    const authorize = await request(`/api/auth/oauth2/authorize?${params}`, undefined, agentCookie);
    expect(authorize.headers.get("location")).toContain("/app/consent");
    const consentUrl = new URL(authorize.headers.get("location")!, baseUrl);
    const consent = await request("/api/auth/oauth2/consent", { accept: true, oauth_query: consentUrl.search.slice(1) }, agentCookie);
    expect(consent.status, await consent.clone().text()).toBe(200);
    const callback = new URL((await consent.json()).url);
    const exchange = await auth.handler(new Request(`${baseUrl}/api/auth/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: oauthClient, code: callback.searchParams.get("code")!, code_verifier: verifier, redirect_uri: `${baseUrl}/callback`, resource: `${baseUrl}/api/mcp` }) }));
    expect(exchange.status, await exchange.clone().text()).toBe(200);
    const token = (await exchange.json()).access_token;
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const ctx = (await contextFromClaims(payload))!;
    expect(ctx.memberId).toBe(agentId);
    expect(ctx.teamId).toBe(ownerTeam);
    const response = await mcpRoute(new Request(`${baseUrl}/api/mcp`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hive_search", arguments: { query: "identity", repo: "fixture/repo" } } }) }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.text()).not.toContain('"isError":true');
  });
  it("allows twelve separate harness grants for the same agent account", async () => {
    for (let index = 0; index < 12; index++) {
      const registration = await request("/api/auth/oauth2/register", { client_name: `Harness ${index}`, application_type: "native", redirect_uris: [`${baseUrl}/callback`], token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"], scope: "hive" });
      expect(registration.status, await registration.clone().text()).toBe(201);
      const clientId = (await registration.json()).client_id;
      harnessClients.push(clientId);
      const verifier = randomBytes(32).toString("base64url");
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: `${baseUrl}/callback`, response_type: "code", scope: "hive", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: `fixture-${index}`, resource: `${baseUrl}/api/mcp` });
      const authorize = await request(`/api/auth/oauth2/authorize?${params}`, undefined, agentCookie);
      const consentQuery = new URL(authorize.headers.get("location")!, baseUrl).search.slice(1);
      const consent = await request("/api/auth/oauth2/consent", { accept: true, oauth_query: consentQuery }, agentCookie);
      expect(consent.status, await consent.clone().text()).toBe(200);
      const callback = new URL((await consent.json()).url);
      const exchange = await auth.handler(new Request(`${baseUrl}/api/auth/oauth2/token`, { method: "POST", headers: { "x-forwarded-for": `198.19.${index}.1`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code: callback.searchParams.get("code")!, code_verifier: verifier, redirect_uri: `${baseUrl}/callback`, resource: `${baseUrl}/api/mcp` }) }));
      expect(exchange.status, await exchange.clone().text()).toBe(200);
      const token = (await exchange.json()).access_token;
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
      expect(payload).toMatchObject({ hive_member_id: agentId, hive_team_id: ownerTeam });
    }
    expect(new Set(harnessClients).size).toBe(12);
  });
});
