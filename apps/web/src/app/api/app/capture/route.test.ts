const policy = vi.hoisted(() => ({workAreas: ""}));
vi.mock("@/server/project-sharing", () => ({requireSelectedProject: vi.fn(async (ctx: unknown) => ({personal: ctx, policy}))}));
import {beforeEach, describe, expect, it, vi} from "vitest";
import {POST} from "./route";
import {enforceCaptureRules} from "@/server/capture-rules";
import {classifyCapture} from "@/server/classify";

const context = {teamId: "team_fixture", memberId: "mem_fixture", teamName: "Fixture", memberName: "Owner"};
vi.mock("@/server/bearer-auth", () => ({withHiveBearerAuth: vi.fn(async (request, action) => action(request, context, {sub: context.memberId}))}));
vi.mock("@/server/capture-rules", () => ({enforceCaptureRules: vi.fn()}));
vi.mock("@/server/classify", () => ({classifyCapture: vi.fn(async () => ({decision: "capture", classification: null}))}));
vi.mock("@/server/identity/rate-limit", () => ({rateLimit: vi.fn()}));
vi.mock("@/server/analytics/events", () => ({originFor: vi.fn(() => ({})), withOrigin: vi.fn(async (_origin, action) => action()), recordEvent: vi.fn()}));
const body = {text: "Private work fixture", changes: 1, errors: 0, observations: 1, remote: "git@host:private/repo.git", cwd: "/Users/fixture/personal", home: "/Users/fixture", paths: ["notes.md"], agent: "claude-code", sessionType: "stop"};
const request = () => new Request("http://localhost/api/app/capture", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
beforeEach(() => {vi.clearAllMocks(); policy.workAreas = "";});
describe("capture ingress", () => {
  it("returns skip on drop before sharing classification and keeps home metadata", async () => {
    vi.mocked(enforceCaptureRules).mockResolvedValue({action: "drop", title: "", body: body.text, redacted: false, flagged: false, matches: [{ruleId: "crule_fixture", kind: "path_match", action: "drop"}], neededCategories: [], categories: {}});
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({decision: "skip", dropped: true, rule: "path_match", classification: null});
    expect(classifyCapture).not.toHaveBeenCalled();
    expect(enforceCaptureRules).toHaveBeenCalledWith(context, expect.objectContaining({home: "/Users/fixture", cwd: body.cwd, remote: body.remote, sessionType: "stop"}), "hook", [], undefined);
  });
  it("sends only redacted text to the sharing classifier", async () => {
    vi.mocked(enforceCaptureRules).mockResolvedValue({action: "redact", title: "", body: "[removed] work fixture", redacted: true, flagged: false, matches: [{ruleId: "crule_fixture", kind: "keyword", action: "redact"}], neededCategories: [], categories: {}});
    const response = await POST(request());
    expect(await response.json()).toMatchObject({decision: "capture", redacted: true});
    expect(classifyCapture).toHaveBeenCalledWith(expect.objectContaining({text: "[removed] work fixture"}));
    expect(JSON.stringify(vi.mocked(classifyCapture).mock.calls)).not.toContain("Private work fixture");
  });
  it("passes the owner's work areas to category tagging and the capture gate", async () => {
    policy.workAreas = "frontend React, dbt models";
    vi.mocked(enforceCaptureRules).mockResolvedValue({action: "allow", title: "", body: "React hydration fix", redacted: false, flagged: false, matches: [], neededCategories: [], categories: {}});
    await POST(request());
    expect(vi.mocked(enforceCaptureRules).mock.calls[0][4]).toBe("frontend React, dbt models");
    expect(classifyCapture).toHaveBeenCalledWith(expect.objectContaining({workAreas: "frontend React, dbt models"}));
  });
});
