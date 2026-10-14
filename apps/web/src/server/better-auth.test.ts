import { clientBeacon } from "./analytics/beacons";
import { withOrigin, originFor, type EventRow } from "./analytics/events";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHiveAuth } from "./better-auth";
import { getDb, getSql } from "./db/client";
import { createTeam, authenticateApiKey } from "./auth";
import { hashToken, newId } from "./db/ids";
import { enrollMember } from "./identity/enrollment";
import { contextFromClaims } from "./bearer-auth";
import { sessionMemberContext } from "./identity/session-context";
import { POST as mcpRoute } from "@/app/api/mcp/route";
import { POST as captureRoute } from "@/app/api/app/capture/route";
import { POST as keyLogin } from "@/app/api/app/session/route";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { authHandler } from "./auth-handler";

const fixture = vi.hoisted(() => ({ auth: undefined as ReturnType<typeof createHiveAuth> | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("./better-auth", async (original) => ({ ...await original<typeof import("./better-auth")>(), getAuth: async () => fixture.auth! }));
vi.mock("./llm/embeddings", () => ({ embedText: async () => null }));

const suffix = randomBytes(8).toString("hex");
const codes = new Map<string, string>();
const events: EventRow[] = [];
const password = "Fixture-password-48";
let baseUrl: string;
let server: Server;
const teamIds: string[] = [];
const memberIds: string[] = [];
let cookiesA: string;
let cookiesB: string;
let memberA: string;
let teamA: string;
let teamB: string;
let legacyKey: string;
let accessToken: string;
let refreshToken: string;
let clientId: string;
let executorClientId: string;
let personClientId: string;
let consentQuery: string;

async function request(path: string, body?: unknown, cookie?: string, method = body === undefined ? "GET" : "POST"): Promise<Response> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: method === "GET" ? "text/html" : "application/json",
        "x-forwarded-for": `198.18.${parseInt(suffix.slice(0,2), 16)}.${parseInt(createHash("sha256").update(JSON.stringify(body ?? path)).digest("hex").slice(0,2), 16)}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: baseUrl,
      },
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        const headers = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers }));
      });
      incoming.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
function sessionCookies(response: Response) { return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; "); }
async function signup(label: string, registration: { intent: string; [key: string]: unknown }) {
  const email = `${label.toLowerCase()}-${suffix}@auth.example.test`;
  const response = await request("/api/auth/sign-up/email", { name: label, email, password, hiveRegistration: JSON.stringify(registration), callbackURL: "/app/join" });
  expect(response.status, await response.clone().text()).toBe(200);
  const body = await response.json();
  memberIds.push(body.user.id);
  expect(codes.get(email)).toMatch(/^\d{6}$/);
  const before = await request("/api/auth/sign-in/email", { email, password });
  expect(before.status).toBe(403);
  const verified = await request("/api/auth/email-otp/verify-email", { email, otp: codes.get(email) });
  expect(verified.status, await verified.clone().text()).toBe(200);
  const signedIn = await request("/api/auth/sign-in/email", { email, password });
  expect(signedIn.status, await signedIn.clone().text()).toBe(200);
  const rows = await getSql()`SELECT h.team_id FROM hive_memberships h JOIN teams t ON t.id = h.team_id WHERE h.member_id = ${body.user.id} AND h.removed_at IS NULL ORDER BY (t.personal_owner_member_id IS NULL) DESC, h.joined_at DESC LIMIT 1`;
  if (rows[0].team_id && registration.intent === "create") teamIds.push(rows[0].team_id);
  const session = await fixture.auth!.api.getSession({ headers: new Headers({ Cookie: sessionCookies(signedIn) }) });
  await getSql()`UPDATE web_sessions SET team_id = ${rows[0].team_id} WHERE id = ${session!.session.id}`;
  return { email, memberId: body.user.id, teamId: rows[0].team_id as string, cookie: sessionCookies(signedIn) };
}

describe.skipIf(!process.env.DATABASE_URL)("Better Auth and MCP OAuth integration", () => {
  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "fixture-secret-with-at-least-thirty-two-characters");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "fixture");
    vi.stubEnv("EMAIL_FROM", "Hive <fixture@auth.example.test>");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("SLACK_CLIENT_ID", "");
    server = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const incoming = new Request(new URL(req.url!, baseUrl), { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        const response = await withOrigin(originFor(), async () => req.url?.startsWith("/api/mcp") ? await mcpRoute(incoming) : req.url?.startsWith("/api/app/capture") ? await captureRoute(incoming) : req.url?.startsWith("/api/analytics/") ? await clientBeacon(incoming, req.url.endsWith("install") ? "install" : "hook") : await authHandler(incoming), async (row) => { events.push(row); });
        res.statusCode = response.status;
        response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
        if (response.headers.getSetCookie().length) res.setHeader("set-cookie", response.headers.getSetCookie());
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch { res.statusCode = 500; res.end("Fixture request failed"); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    fixture.auth = createHiveAuth(baseUrl, async (email, code) => { codes.set(email, code); return true; });
    const a = await signup("Alpha", { intent: "create", teamName: "OAuth Alpha" });
    const b = await signup("Beta", { intent: "create", teamName: "OAuth Beta" });
    cookiesA = a.cookie; cookiesB = b.cookie; memberA = a.memberId; teamA = a.teamId; teamB = b.teamId;
    const legacy = await createTeam({ teamName: "Legacy auth fixture", memberName: "Existing member" });
    teamIds.push(legacy.ctx.teamId); memberIds.push(legacy.ctx.memberId); legacyKey = legacy.apiKey;
    const sql = getSql();
    const cellId = newId("lrn");
    await sql`INSERT INTO learnings (id, team_id, member_id, title, body, kind, source, confidence) VALUES (${cellId}, ${teamB}, ${b.memberId}, 'Team Beta private canary', 'A separate hive cell.', 'learning', 'manual', 1)`;
    await sql`INSERT INTO learnings (id, team_id, member_id, title, body, kind, source, confidence) VALUES (${newId("lrn")}, ${teamA}, ${a.memberId}, 'Team Alpha visible canary', 'This hive can read its own cell.', 'learning', 'manual', 1)`;
  }, 30000);
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (teamIds.length) {
      const sql = getSql();
      for (const table of ["capture_rules", "learning_conflict_votes", "learning_supersessions", "learning_versions", "feedback", "learning_pushes", "ask_log", "learnings", "api_keys", "web_sessions", "team_domains"]) await sql`DELETE FROM ${sql(table)} WHERE team_id IN ${sql(teamIds)}`;
      if (clientId) await sql`DELETE FROM auth_oauth_client WHERE client_id = ${clientId}`;
    if (executorClientId) await sql`DELETE FROM auth_oauth_client WHERE client_id = ${executorClientId}`;
    if (personClientId) await sql`DELETE FROM auth_oauth_client WHERE client_id = ${personClientId}`;
      await sql`DELETE FROM members WHERE id IN ${sql(memberIds)}`;
      await sql`DELETE FROM teams WHERE id IN ${sql(teamIds)}`;
      await sql`DELETE FROM auth_verification WHERE identifier LIKE ${`%${suffix}%`}`;
      await sql`DELETE FROM rate_limits WHERE bucket LIKE ${`%${suffix}%`}`;
      await getDb().$client.end();
      await sql.end();
    }
    vi.unstubAllEnvs();
  });
  it("records verified enrollment, scoped sessions and anonymous failures without credentials", async () => {
    const rows = events.filter((row) => row.member_id === memberA && row.event_name === "access.changed");
    for (const outcome of ["signup", "email_verified", "invite_created", "role_changed", "login"]) expect(rows.some((row) => row.outcome === outcome), outcome).toBe(true);
    expect(rows.find((row) => row.outcome === "signup")).toMatchObject({ team_id: teamA, properties: { role: "admin" } });
    expect(events.some((row) => row.outcome === "email_verification_sent" && row.team_id === null)).toBe(true);
    const failed = await request("/api/auth/sign-in/email", { email: `alpha-${suffix}@auth.example.test`, password: "wrong-password" });
    expect(failed.status).toBe(401);
    expect(events.at(-1)).toMatchObject({ outcome: "login_failed", member_id: null, team_id: null, reason_code: "invalid_credentials" });
    const text = JSON.stringify(events);
    for (const secret of [password, "wrong-password", "@auth.example.test", ...codes.values()]) expect(text).not.toContain(secret);
    const signedIn = await request("/api/auth/sign-in/email", { email: `alpha-${suffix}@auth.example.test`, password });
    expect(signedIn.status).toBe(200);
    const out = await request("/api/auth/sign-out", {}, sessionCookies(signedIn));
    expect(out.status).toBe(200);
    expect(events.at(-1)).toMatchObject({ outcome: "logout", member_id: memberA, team_id: null });
  });
  it("keeps the member table and legacy keys intact and removes key web login", async () => {
    expect(await authenticateApiKey(legacyKey)).not.toBeNull();
    expect((await keyLogin()).status).toBe(410);
    const rows = await getSql()`SELECT h.role, m.email_verified FROM members m JOIN hive_memberships h ON h.member_id = m.id WHERE m.id = ${memberA} AND h.team_id = ${teamA}`;
    expect(rows[0]).toMatchObject({ role: "admin", email_verified: true });
  });
  it("joins only the verified invite or allowed work domain as a member", async () => {
    const domain = `${suffix}.work.example.test`;
    await getSql()`INSERT INTO team_domains (team_id, domain, created_by) VALUES (${teamA}, ${domain}, ${memberA})`;
    const id = newId("mem");
    const unverified = newId("mem");
    memberIds.push(id, unverified);
    await getSql()`INSERT INTO members (id, name, email, email_verified) VALUES (${id}, 'Work fixture', ${`forager@${domain}`}, true), (${unverified}, 'Pending fixture', ${`pending@${domain}`}, false)`;
    expect((await enrollMember(id, { intent: "domain" }))?.teamId).toBe(teamA);
    const roles = await getSql()`SELECT role FROM hive_memberships WHERE member_id = ${id} AND team_id = ${teamA}`;
    expect(roles[0].role).toBe("member");
    await expect(enrollMember(unverified, { intent: "domain" })).rejects.toThrow("Verify your email");
    const invite = `hive-${suffix}`;
    await getSql()`UPDATE teams SET invite_code = ${hashToken(invite)} WHERE id = ${teamB}`;
    const publicMember = newId("mem");
    memberIds.push(publicMember);
    await getSql()`INSERT INTO members (id, name, email, email_verified) VALUES (${publicMember}, 'Invite fixture', ${`${suffix}@gmail.com`}, true)`;
    await expect(enrollMember(publicMember, { intent: "domain" })).rejects.toThrow(/invite/i);
    expect((await enrollMember(publicMember, { intent: "invite", inviteCode: `${baseUrl}/app/login?invite=${invite}` }))?.teamId).toBe(teamB);
    const second = await enrollMember(publicMember, { intent: "create", teamName: "Another hive" });
    teamIds.push(second!.teamId);
    expect(second?.teamId).not.toBe(teamB);
    expect((await getSql()`SELECT team_id FROM hive_memberships WHERE member_id = ${publicMember} AND removed_at IS NULL`)).toHaveLength(3);
  });
  it("upgrades real legacy rows without replacing their identities, roles, keys or session hashes", async () => {
    const sql = getSql();
    const namespace = `auth_migration_${suffix}`;
    const rollback = new Error("Roll back the isolated migration fixture");
    try {
      await sql.begin(async (tx) => {
        await tx`CREATE SCHEMA ${tx(namespace)}`;
        await tx`SET LOCAL search_path TO ${tx(namespace)}`;
        await tx.unsafe(await readFile(new URL("../../drizzle/0001_init.sql", import.meta.url), "utf8"));
        await tx.unsafe(await readFile(new URL("../../drizzle/0004_email_access.sql", import.meta.url), "utf8"));
        await tx`INSERT INTO teams (id, name, invite_code) VALUES ('team_legacy', 'Legacy fixture', ${hashToken("invite")})`;
        await tx`INSERT INTO members (id, team_id, name, role) VALUES ('mem_legacy', 'team_legacy', 'Legacy fixture', 'admin')`;
        await tx`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix) VALUES ('key_legacy', 'team_legacy', 'mem_legacy', ${hashToken("legacy-key")}, 'fixture')`;
        await tx`INSERT INTO web_sessions (id, team_id, member_id, token_hash, expires_at) VALUES ('ses_legacy', 'team_legacy', 'mem_legacy', ${hashToken("legacy-session")}, now() + interval '1 day')`;
        await tx.unsafe(await readFile(new URL("../../drizzle/0011_better_auth.sql", import.meta.url), "utf8"));
        const members = await tx`SELECT id, role, email FROM members`;
        const keys = await tx`SELECT key_hash FROM api_keys`;
        const sessions = await tx`SELECT token_hash, token FROM web_sessions`;
        expect(members[0]).toMatchObject({ id: "mem_legacy", role: "admin", email: null });
        expect(keys[0].key_hash).toBe(hashToken("legacy-key"));
        expect(sessions[0]).toMatchObject({ token_hash: hashToken("legacy-session"), token: null });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
  it("uses an email reset code to add a password to the same legacy member", async () => {
    const legacy = await authenticateApiKey(legacyKey);
    const email = `legacy-${suffix}@auth.example.test`;
    await getSql()`UPDATE members SET email = ${email}, email_verified = true WHERE id = ${legacy!.memberId}`;
    const sent = await request("/api/auth/email-otp/request-password-reset", { email });
    expect(sent.status, await sent.clone().text()).toBe(200);
    const reset = await request("/api/auth/email-otp/reset-password", { email, otp: codes.get(email), password });
    expect(reset.status, await reset.clone().text()).toBe(200);
    const signedIn = await request("/api/auth/sign-in/email", { email, password });
    expect(signedIn.status, await signedIn.clone().text()).toBe(200);
    const rows = await getSql()`SELECT user_id FROM auth_accounts WHERE provider_id = 'credential' AND user_id = ${legacy!.memberId}`;
    expect(rows[0].user_id).toBe(legacy!.memberId);
    expect((await authenticateApiKey(legacyKey))?.teamId).toBe(legacy!.teamId);
  });
  it("advertises protected-resource metadata, CIMD and unauthenticated DCR", async () => {
    const response = await request("/.well-known/oauth-protected-resource");
    expect(response.status).toBe(200);
    const metadata = await response.json();
    expect(metadata.resource).toBe(`${baseUrl}/api/mcp`);
    const issuer = metadata.authorization_servers[0];
    const discovery = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
    const config = await discovery.json();
    expect(config.client_id_metadata_document_supported).toBe(true);
    expect(config.registration_endpoint).toBe(`${baseUrl}/api/auth/oauth2/register`);
    expect(config.code_challenge_methods_supported).toEqual(["S256"]);
  });
  it("serves discovery and signing keys without database rate-limit writes", async () => {
    const counted = async () => Number((await getSql()`SELECT count(*)::int + coalesce(sum(count), 0)::int AS total FROM auth_rate_limit`)[0].total);
    const before = await counted();
    for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server/api/auth", "/api/auth/jwks"]) expect((await request(path)).status).toBe(200);
    expect(await counted()).toBe(before);
    expect((await request("/api/auth/sign-in/email", { email: `nobody-${suffix}@auth.example.test`, password })).status).toBe(401);
    expect(await counted()).toBeGreaterThan(before);
  });
  it("challenges requests without a key or OAuth token", async () => {
    const response = await request("/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="'+baseUrl+'/.well-known/oauth-protected-resource/api/mcp"');
  });
  it("registers a hosted client with a non-loopback HTTPS redirect", async () => {
    const redirect = "https://executor.example.test/oauth/callback";
    const response = await request("/api/auth/oauth2/register", { client_name: "Executor fixture", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "hive offline_access" });
    expect(response.status, await response.clone().text()).toBe(201);
    const registered = await response.json();
    executorClientId = registered.client_id;
    expect(registered.redirect_uris).toEqual([redirect]);
    expect(registered.application_type).toBe("web");
  });
  it("mints a PKCE token after signed consent and accepts it at the real MCP handler", async () => {
    const registration = await request("/api/auth/oauth2/register", { client_name: "Auth fixture forager", redirect_uris: [`${baseUrl}/callback`], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "hive offline_access" });
    expect(registration.status, await registration.clone().text()).toBe(201);
    clientId = (await registration.json()).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: `${baseUrl}/callback`, response_type: "code", scope: "hive offline_access", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "fixture-state", resource: `${baseUrl}/api/mcp` });
    const loggedOut = await request(`/api/auth/oauth2/authorize?${params}`);
    expect(loggedOut.status).toBe(302);
    expect(loggedOut.headers.get("location")).toContain("/app/login");
    const authorize = await request(`/api/auth/oauth2/authorize?${params}`, undefined, cookiesA);
    expect(authorize.status, await authorize.clone().text()).toBe(302);
    const location = new URL(authorize.headers.get("location")!, baseUrl);
    expect(location.pathname).toBe("/app/consent");
    consentQuery = location.search.slice(1);
    const { secret } = await fixture.auth!.$context;
    expect(await verifyOAuthQueryParams(consentQuery, secret)).toBe(true);
    expect(await verifyOAuthQueryParams(consentQuery.replace("hive", "admin"), secret)).toBe(false);
    const grantCount = () => events.filter((row) => row.outcome === "mcp_oauth_authorized").length;
    const beforeGrant = grantCount();
    const denied = await request("/api/auth/oauth2/consent", { accept: false, oauth_query: consentQuery }, cookiesA);
    expect(denied.status).toBe(200);
    expect(grantCount()).toBe(beforeGrant);
    await request("/api/auth/oauth2/consent", { accept: true, oauth_query: "invalid" }, cookiesA);
    expect(grantCount()).toBe(beforeGrant);
    const consent = await request("/api/auth/oauth2/consent", { accept: true, oauth_query: consentQuery }, cookiesA);
    expect(grantCount()).toBe(beforeGrant + 1);
    expect(events.at(-1)).toMatchObject({ outcome: "mcp_oauth_authorized", team_id: null, member_id: memberA });
    expect(consent.status, await consent.clone().text()).toBe(200);
    const callback = new URL((await consent.json()).url);
    expect(callback.searchParams.get("state")).toBe("fixture-state");
    const exchange = await fetch(`${baseUrl}/api/auth/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code: callback.searchParams.get("code")!, code_verifier: verifier, redirect_uri: `${baseUrl}/callback`, resource: `${baseUrl}/api/mcp` }) });
    expect(exchange.status, await exchange.clone().text()).toBe(200);
    const tokens = await exchange.json(); accessToken = tokens.access_token; refreshToken = tokens.refresh_token;
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
    expect(payload).toMatchObject({ hive_member_id: memberA, hive_team_id: teamA, aud: `${baseUrl}/api/mcp` });
    const response = await fetch(`${baseUrl}/api/mcp`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hive_recent", arguments: { since: "7d", limit: 50 } } }) });
    expect(response.status, await response.clone().text()).toBe(200);
    const stream = await response.text();
    const result = JSON.parse(stream.split("\n").find((line) => line.startsWith("data:"))!.slice(5));
    expect(result.result.isError).not.toBe(true);
    expect(stream).toContain("Team Alpha visible canary");
    expect(stream).not.toContain("Team Beta private canary");
  });
  it("rejects cross-team and missing identity claims", async () => {
    expect(await contextFromClaims({ sub: memberA, hive_member_id: memberA, hive_team_id: teamB })).toBeNull();
    expect(await contextFromClaims({ sub: memberA })).toBeNull();
  });
  it("asks fresh person-wide consent and follows later memberships without widening a team token", async () => {
    const scope = "hive hive:person offline_access";
    const registration = await request("/api/auth/oauth2/register", { client_name: "Person fixture", application_type: "native", redirect_uris: [`${baseUrl}/person-callback`], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope });
    expect(registration.status, await registration.clone().text()).toBe(201);
    personClientId = (await registration.json()).client_id;
    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({ client_id: personClientId, redirect_uri: `${baseUrl}/person-callback`, response_type: "code", scope, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "person-fixture", resource: `${baseUrl}/api/mcp` });
    const authorize = await request(`/api/auth/oauth2/authorize?${query}`, undefined, cookiesA);
    const location = new URL(authorize.headers.get("location")!, baseUrl);
    expect(location.pathname).toBe("/app/consent");
    const consent = await request("/api/auth/oauth2/consent", { accept: true, oauth_query: location.search.slice(1) }, cookiesA);
    const callback = new URL((await consent.json()).url);
    const exchange = await fetch(`${baseUrl}/api/auth/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: personClientId, code: callback.searchParams.get("code")!, code_verifier: verifier, redirect_uri: `${baseUrl}/person-callback`, resource: `${baseUrl}/api/mcp` }) });
    expect(exchange.status, await exchange.clone().text()).toBe(200);
    const token = (await exchange.json()).access_token;
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(payload).toMatchObject({ hive_member_id: memberA, hive_team_id: `team_personal_${memberA}`, hive_access: "person", hive_credential_version: 2 });
    const recent = async (credential: string) => {
      const response = await fetch(`${baseUrl}/api/mcp`, { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hive_recent", arguments: { since: "7d", limit: 50 } } }) });
      expect(response.status).toBe(200);
      return response.text();
    };
    expect(await recent(token)).toContain("Team Alpha visible canary");
    expect(await recent(token)).not.toContain("Team Beta private canary");
    await getSql()`INSERT INTO hive_memberships (member_id,team_id) VALUES (${memberA},${teamB})`;
    try {
      expect(await recent(token)).toContain("Team Beta private canary");
      expect(await recent(accessToken)).not.toContain("Team Beta private canary");
    } finally { await getSql()`DELETE FROM hive_memberships WHERE member_id=${memberA} AND team_id=${teamB}`; }
    expect(await contextFromClaims({ ...payload, hive_credential_version: 1 })).toBeNull();
    expect(await contextFromClaims({ ...payload, hive_credential_epoch: -1 })).toBeNull();
    expect(await contextFromClaims({ ...payload, scope: "hive" })).toBeNull();
  });
  it("accepts scoped OAuth and keys in MCP while the Stop gate requires project selection", async () => {
    for (const token of [accessToken, legacyKey]) {
      expect(token).toBeTruthy();
      const response = await fetch(`${baseUrl}/api/app/capture`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ changes: 0, errors: 0, observations: 0, text: "Quiet fixture" }) });
      expect(response.status, await response.clone().text()).toBe(403);
      expect((await response.json()).error).toContain("No projects selected");
      const mcp = await fetch(`${baseUrl}/api/mcp`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      expect(mcp.status).toBe(200);
      expect(await mcp.text()).toContain("hive_recent");
    }
  });
  it("accepts OAuth and legacy key installer and hook reports with the trusted identity", async () => {
    for (const token of [accessToken, legacyKey]) {
      for (const kind of ["install", "hook"] as const) {
        const input = kind === "install" ? { step: "doctor", outcome: "completed", agent: "executor", platform: "darwin" } : { hookKind: "session_start", gateDecision: "skip", pushedCount: 0 };
        const body = { ...input, attemptId: "00000000-0000-4000-8000-000000000003", teamId: "other", transcript: "private canary" };
        const send = () => fetch(`${baseUrl}/api/analytics/${kind}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        expect((await send()).status).toBe(204);
        const first = events.at(-1)!;
        expect((await send()).status).toBe(204);
        expect(events.at(-1)!.event_key).toBe(first.event_key);
        expect(first).toMatchObject({ session_kind: token === accessToken ? "oauth" : "api_key", entrypoint: kind === "install" ? "installer" : "hook" });
        expect(first.team_id).toBe(token === accessToken ? teamA : (await authenticateApiKey(legacyKey))!.teamId);
        if (kind === "install") expect(first.properties.agent).toBe("executor");
        expect(JSON.stringify(first)).not.toContain("private canary");
      }
    }
    const count = events.length;
    for (const kind of ["install", "hook"]) {
      const denied = await fetch(`${baseUrl}/api/analytics/${kind}`, { method: "POST", headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" }, body: "{}" });
      expect(denied.status).toBe(401);
    }
    expect(events).toHaveLength(count);
  });
  it("refreshes the grant with the same team binding and rejects a removed member", async () => {
    const response = await fetch(`${baseUrl}/api/auth/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken, resource: `${baseUrl}/api/mcp` }) });
    expect(response.status, await response.clone().text()).toBe(200);
    const tokens = await response.json();
    await getSql()`UPDATE hive_memberships SET removed_at = now() WHERE member_id = ${memberA} AND team_id = ${teamA}`;
    const mcp = await fetch(`${baseUrl}/api/mcp`, { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(mcp.status).toBe(403);
    const beforeReports = events.length;
    for (const kind of ["install", "hook"]) {
      const denied = await fetch(`${baseUrl}/api/analytics/${kind}`, { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json" }, body: "{}" });
      expect(denied.status).toBe(403);
    }
    expect(events).toHaveLength(beforeReports);
  });
  it("keeps hash-only sessions in their explicit membership context", async () => {
    const sql = getSql();
    const legacy = await authenticateApiKey(legacyKey);
    const member = legacy!.memberId;
    const team = legacy!.teamId;
    const id = newId("ses");
    const hash = hashToken("legacy-fixture-session");
    await sql`INSERT INTO web_sessions (id, member_id, team_id, token_hash, expires_at) VALUES (${id}, ${member}, ${team}, ${hash}, now() + interval '1 day')`;
    expect((await sessionMemberContext(member, id))?.teamId).toBe(team);
    const rows = await sql`SELECT token_hash, token FROM web_sessions WHERE id = ${id}`;
    expect(rows[0]).toMatchObject({ token_hash: hash, token: null });
  });
});
