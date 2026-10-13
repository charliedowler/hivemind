// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureRule } from "@hivemind/core";
import { CaptureRules } from "./capture-rules";
import { CaptureCellNote } from "./capture-cell-note";
import { captureDefaults, defaultCaptureRuleId } from "@/lib/capture-defaults";
import { requestJson } from "@/lib/client";

vi.mock("@/lib/client", () => ({requestJson: vi.fn(), errorMessage: (error: Error) => error.message}));
vi.mock("next/navigation", () => ({useRouter: () => ({refresh() {}})}));
const base = {teamId: "team_test", memberId: null, createdBy: "member_test", createdAt: "2026-10-13T10:00:00Z", updatedAt: "2026-10-13T10:00:00Z", scope: "team", enabled: true, action: "drop", source: "web"} as const;
const defaults: CaptureRule[] = captureDefaults.map(item => ({...base, id: defaultCaptureRuleId(base.teamId, item.category), name: item.label, kind: "content_category", category: item.category}));
const custom: CaptureRule = {...base, id: "crule_wayfarer", name: "Skip wayfarer", kind: "repo_match", pattern: "*/wayfarer"};
let root: Root;
let host: HTMLDivElement;
const api = vi.mocked(requestJson);
const click = async (element: Element | null) => {expect(element).not.toBeNull(); await act(async () => (element as HTMLElement).click());};
const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label)!;
async function mount(isAdmin = true, scope?: "team" | "personal", rules = defaults) {
  await act(async () => root.render(<CaptureRules initial={{rules, isAdmin}} scope={scope} />));
}
async function send(text: string) {
  const input = host.querySelector("input:not([type=checkbox])")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", {bubbles: true}));
  });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true})));
}
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove();});

describe("What Hive keeps", () => {
  it("shows three enabled defaults with no structured controls or internal vocabulary", async () => {
    await mount();
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(3);
    expect([...host.querySelectorAll<HTMLInputElement>('[role="switch"]')].every(item => item.checked)).toBe(true);
    expect(host.textContent).toContain("Describe something Hive should not keep");
    expect(host.textContent).not.toMatch(/\b(rule|matcher|preview|application|scope)\b/i);
  });
  it("makes team choices read-only for members", async () => {
    await mount(false, "team", [...defaults, custom]);
    expect(host.querySelector("form")).toBeNull();
    expect(button("Delete")).toBeUndefined();
    expect([...host.querySelectorAll<HTMLInputElement>('[role="switch"]')].every(item => item.disabled)).toBe(true);
  });
  it("shows only your exclusions in personal mode and lets a member save", async () => {
    await mount(false, "personal", [...defaults, {...custom, scope: "member", memberId: "member_test"}]);
    expect(host.textContent).toContain("What your agents keep");
    expect(host.textContent).not.toContain("Exclude credentials");
    api.mockResolvedValueOnce({status: "saved", rule: {...custom, scope: "member", memberId: "member_test"}});
    await send("never keep anything from the wayfarer repo");
    expect(api).toHaveBeenCalledWith("/api/app/capture-rules/propose", {text: "never keep anything from the wayfarer repo", scope: "personal"});
  });
  it("saves a sentence immediately, highlights one line, and undoes that result", async () => {
    await mount();
    api.mockResolvedValueOnce({status: "saved", rule: custom, undoUntil: new Date(Date.now() + 3600000).toISOString()});
    await send("never keep anything from the wayfarer repo");
    expect(api).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')!.textContent).toBe("Skip captures from repos matching */wayfarer. Undo");
    expect(button("Confirm")).toBeUndefined();
    expect(host.textContent).toContain("Delete");
    api.mockResolvedValueOnce({status: "undone", counts: {restored: 2}});
    await click(button("Undo"));
    expect(api).toHaveBeenLastCalledWith("/api/app/capture-rules/undo", {ruleId: custom.id});
    expect(host.textContent).toContain("2 cells restored");
    expect(button("Delete")).toBeUndefined();
  });
  it("keeps the original instruction with a missing-detail reply", async () => {
    await mount(); api.mockResolvedValueOnce({status: "question", question: "Which repo?"});
    await send("never keep anything from that repo");
    api.mockResolvedValueOnce({status: "saved", rule: custom});
    await send("wayfarer");
    expect(api).toHaveBeenLastCalledWith("/api/app/capture-rules/propose", {text: "never keep anything from that repo\nRequired detail: wayfarer", scope: "team"});
  });
  it("toggles a default and restores the previous state with Undo", async () => {
    await mount(); api.mockResolvedValueOnce({...defaults[0], enabled: false});
    await click(host.querySelector('[role="switch"]'));
    expect((host.querySelector('[role="switch"]') as HTMLInputElement).checked).toBe(false);
    api.mockResolvedValueOnce(defaults[0]); await click(button("Undo"));
    expect((host.querySelector('[role="switch"]') as HTMLInputElement).checked).toBe(true);
    expect(api).toHaveBeenLastCalledWith(`/api/app/capture-rules/${defaults[0].id}`, defaults[0], undefined, "PATCH");
  });
  it("deletes once and restores the exclusion without reversing older cell changes", async () => {
    await mount(true, "team", [...defaults, custom]); api.mockResolvedValueOnce({id: custom.id});
    await click(button("Delete"));
    expect(api).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Earlier changes to cells stay as they are");
    api.mockResolvedValueOnce({...custom, id: "crule_restored"}); await click(button("Undo"));
    expect(api).toHaveBeenLastCalledWith("/api/app/capture-rules", custom);
    expect(button("Delete")).toBeDefined();
  });
  it("preserves the choices and entered sentence on a failed save", async () => {
    await mount(); api.mockRejectedValueOnce(new Error("Connection lost")); await send("leave out wayfarer");
    expect(host.textContent).toContain("Connection lost");
    expect((host.querySelector("input:not([type=checkbox])") as HTMLInputElement).value).toBe("leave out wayfarer");
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(3);
  });
  it("keeps owner confirmation before releasing a private cell", () => {
    const html = renderToStaticMarkup(<CaptureCellNote id="lrn_test" flagged redacted={false} canConfirm />);
    expect(html).toContain("I confirm this cell is safe for the team to read");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm and share cell<\/button>/);
    expect(renderToStaticMarkup(<CaptureCellNote id="lrn_test" flagged redacted={false} />)).not.toContain("Confirm and share cell");
  });
});
