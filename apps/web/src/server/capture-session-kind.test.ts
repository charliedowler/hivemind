import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getSql } from "./db/client";
import { hashToken, newId } from "./db/ids";
import { memberContext } from "./identity/enrollment";
import { shareProjects } from "./project-sharing";
import { pushLearning } from "./hive";
import { originFor, withOrigin } from "./analytics/events";
vi.mock("server-only", () => ({}));
vi.mock("./classify", async original => ({ ...await original<typeof import("./classify")>(), classifyPush: async (input: { kind?: string }) => ({ classification: null, decision: { action: "accept", kind: input.kind ?? "learning", tags: [] } }) }));
vi.mock("./capture-categories", () => ({ classifyCaptureCategories: async (_input: unknown, categories: string[]) => Object.fromEntries(categories.map(c => [c, false])) }));
vi.mock("./llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("./llm/tagger", () => ({ suggestTags: async () => [] }));
vi.mock("./memory-judgments", () => ({ judgeMemory: async () => ({ tags: [], relations: [] }), rerankMemory: async (_query: string, hits: unknown[]) => hits }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

describe.skipIf(!process.env.DATABASE_URL)("capture from organisation-connected sessions", () => {
  it("a person connected to the organisation hive with team OAuth can push from a selected project", async () => {
    const sql = getSql();
    const teamId = newId("team"), person = newId("mem"), domain = `${randomBytes(6).toString("hex")}.example.test`;
    await sql`INSERT INTO members (id,name,email,email_verified) VALUES (${person},'Josh fixture',${`${person}@${domain}`},true)`;
    await sql`INSERT INTO teams (id,name,invite_code) VALUES (${teamId},'Org fixture',${hashToken(teamId)})`;
    await sql`INSERT INTO hive_memberships (member_id,team_id,role) VALUES (${person},${teamId},'member')`;
    await sql`SELECT hive_ensure_personal_hive(${person})`;
    const orgCtx = (await memberContext(person, teamId))!;
    await withOrigin(originFor(orgCtx, "mcp", "oauth"), () => shareProjects(orgCtx, { include: ["github.com/lightdash/*"], revision: 0, humanInstruction: "Which projects should Hive learn from? → github.com/lightdash/*" }));
    const hookInput = { observation: "Learned that the simulator drops edge swipes before they reach the app, so use a longer drag.", evidence: { session_excerpt: "Learned that the simulator drops edge swipes" }, context: { cwd: "/Users/josh/repos/sanctuary", home: "/Users/josh", remote: "github.com/lightdash/sanctuary", repo: "lightdash/sanctuary", branch: "main", paths: [], agent: "claude-code", sessionType: "cli", sessionRef: "sess-1" } };
    let error: unknown = null;
    const result = await withOrigin(originFor(orgCtx, "mcp", "oauth"), () => pushLearning(orgCtx, hookInput as never)).catch(e => { error = e; return null; });
    expect(error).toBeNull();
    if (!result || result.dropped) throw new Error("Capture unexpectedly dropped");
    const personal = await sql`SELECT id FROM teams WHERE personal_owner_member_id = ${person}`;
    expect((await sql`SELECT team_id, member_id FROM learnings WHERE id = ${result.id}`)[0]).toEqual({ team_id: personal[0].id, member_id: person });
    // An API-key session connected to the organisation hive lands in the personal hive too.
    const second = await withOrigin(originFor(orgCtx, "mcp", "api_key"), () => pushLearning(orgCtx, { ...hookInput, observation: "Discovered that the Android emulator's minimum disk size does not shrink with the data partition." } as never));
    if (second.dropped) throw new Error("Second capture unexpectedly dropped");
    expect((await sql`SELECT team_id FROM learnings WHERE id = ${second.id}`)[0].team_id).toBe(personal[0].id);
    expect(await sql`SELECT id FROM learnings WHERE team_id = ${teamId}`).toHaveLength(0);
  });
});
