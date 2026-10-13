import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { createHiveAuth } from "../better-auth";
import { bindVerifiedOwner } from "./legacy-owner-fixture";
import { claimWelcome, deliverWelcome, issueWelcomeLink } from "./welcome";

vi.mock("server-only", () => ({}));

describe.skipIf(!process.env.DATABASE_URL)("welcome claim", () => {
  const sql = getSql();
  const ids: string[] = [];
  async function owner() {
    vi.stubEnv("BETTER_AUTH_SECRET", "fixture-secret-with-at-least-thirty-two-characters");
    const suffix = randomBytes(8).toString("hex");
    const id = await sql.begin(tx => bindVerifiedOwner(tx, { sub: `welcome-${suffix}`, email: `welcome-${suffix}@example.test`, name: "A human" }, true));
    ids.push(id!);
    return id!;
  }
  const token = (url: string) => new URL(url).searchParams.get("token")!;
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
  afterAll(async () => {
    for (const id of ids) {
      await sql`DELETE FROM auth_verification WHERE id = ${`hive-welcome:${id}`}`;
      await sql`DELETE FROM web_sessions WHERE member_id = ${id}`;
      await sql`DELETE FROM capture_rules WHERE team_id IN (SELECT id FROM teams WHERE personal_owner_member_id = ${id})`;
      await sql`DELETE FROM members WHERE id = ${id}`;
    }
  });
  it("issues one stable signed link and atomically permits only one concurrent claim", async () => {
    const id = await owner();
    const links = await Promise.all([issueWelcomeLink(id), issueWelcomeLink(id)]);
    expect(links[0]).toBe(links[1]);
    const results = await Promise.allSettled([claimWelcome(token(links[0])), claimWelcome(token(links[0]))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await sql`SELECT provisional, email_verified FROM members WHERE id = ${id}`)[0]).toEqual({ provisional: false, email_verified: true });
    expect(await sql`SELECT id FROM web_sessions WHERE member_id = ${id}`).toHaveLength(1);
  });
  it("expires after 24 hours and rejects tampering without creating a session", async () => {
    const id = await owner();
    const value = token(await issueWelcomeLink(id));
    await expect(claimWelcome(`${value}x`)).rejects.toThrow(/expired/);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 86401000);
    await expect(claimWelcome(value)).rejects.toThrow(/expired/);
    expect(await sql`SELECT id FROM web_sessions WHERE member_id = ${id}`).toHaveLength(0);
  });
  it("never verifies a password collision or a changed email", async () => {
    const id = await owner();
    const value = token(await issueWelcomeLink(id));
    await sql`INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password) VALUES (${newId("auth")}, ${id}, ${id}, 'credential', 'password-hash')`;
    await expect(claimWelcome(value)).rejects.toThrow(/expired/);
    expect((await sql`SELECT email_verified FROM members WHERE id = ${id}`)[0].email_verified).toBe(false);
    await sql`DELETE FROM auth_accounts WHERE user_id = ${id}`;
    await sql`UPDATE members SET email = ${`changed-${id}@example.test`} WHERE id = ${id}`;
    await expect(claimWelcome(value)).rejects.toThrow(/expired/);
  });
  it("retries the same message and delivery key, then skips all later sends", async () => {
    const id = await owner();
    vi.stubEnv("RESEND_API_KEY", "fixture"); vi.stubEnv("EMAIL_FROM", "Hive <hive@example.test>");
    const sent: { key: string; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      sent.push({ key: init.headers["Idempotency-Key"], body: init.body });
      return new Response(JSON.stringify(sent.length === 1 ? {} : { id: "email-id" }), { status: sent.length === 1 ? 503 : 200 });
    }));
    await Promise.all([deliverWelcome(id), deliverWelcome(id)]);
    await deliverWelcome(id);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(JSON.parse(sent[0].body).text).toContain("Your agent set up your personal Hive.");
    expect(JSON.parse(sent[0].body).text).not.toContain("saved so far");
  });
  it("sets a valid Better Auth human session and lands on /app", async () => {
    const id = await owner();
    const url = new URL(await issueWelcomeLink(id)); url.host = "localhost:3000"; url.protocol = "http:";
    const auth = createHiveAuth("http://localhost:3000");
    const response = await auth.handler(new Request(url));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app");
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toContain("better-auth.session_token=");
    const session = await auth.api.getSession({ headers: new Headers({ Cookie: cookie! }) });
    expect(session?.user.id).toBe(id);
    expect(session?.user.emailVerified).toBe(true);
    const replay = await auth.handler(new Request(url));
    expect(replay.headers.get("location")).toContain("claim_expired");
  });
});
