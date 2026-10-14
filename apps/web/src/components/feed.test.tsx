import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@hivemind/core";
import { Feed } from "./feed";
import { LearningCard, SearchHitCard } from "./learning-card";
import { requestJson } from "@/lib/client";

vi.mock("@/lib/client", async (original) => ({
  ...(await original<typeof import("@/lib/client")>()),
  requestJson: vi.fn(),
}));
vi.mock("./learning-dialog", () => ({
  LearningDialog: ({ id, onClose }: { id: string; onClose: () => void }) => (
    <div role="dialog">
      <span>{id}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const cell: SearchHit = {
  id: "lrn_test",
  title: "Use the exact stash reference",
  body: "Worktrees share stashes.",
  kind: "gotcha",
  repo: "team/web",
  paths: [],
  tags: [],
  confidence: 0.9,
  source: "codex",
  author: { id: "mem_test", name: "Sam" },
  pushCount: 4,
  votes: { up: 3, down: 0, outdated: 0 },
  lifecycle: "confirmed",
  createdAt: "2026-10-13T09:00:00Z",
  updatedAt: "2026-10-13T09:00:00Z",
  lastPushedAt: "2026-10-13T09:00:00Z",
  score: 1,
  signals: { vector: 1, fts: 1, recency: 1, votes: 1, repoMatch: true },
};

for (const variant of ["grid", "search"] as const) {
  const render = (hit: SearchHit) =>
    new JSDOM(
      renderToStaticMarkup(
        variant === "grid" ? (
          <LearningCard learning={hit} onOpen={() => {}} />
        ) : (
          <SearchHitCard hit={hit} onOpen={() => {}} />
        ),
      ),
    ).window.document;
  describe(`${variant} card labels`, () => {
    it.each([
      "learning",
      "gotcha",
      "snippet",
      "incident",
      "insight",
      "decision",
      "friction",
    ] as const)("shows the display kind for %s", (kind) => {
      const text = render({ ...cell, kind }).body.textContent!;
      expect(text).toContain(
        kind === "decision" || kind === "friction" ? kind : "learning",
      );
      if (!["learning", "decision", "friction"].includes(kind))
        expect(text).not.toContain(kind);
    });
    it.each([
      ["fresh", null],
      ["confirmed", "Seen 4 times"],
      ["outdated", "Outdated"],
      ["superseded", "Replaced"],
    ] as const)("shows only the lifecycle badge for %s", (lifecycle, label) => {
      const document = render({ ...cell, lifecycle, verifyBeforeUse: true });
      expect(
        [...document.querySelectorAll(".hm-badge")].map(
          (node) => node.textContent,
        ),
      ).toEqual(label ? [label] : []);
      expect(document.body.textContent).not.toMatch(
        /Fresh|Confirmed|superseded|retracted/,
      );
    });
    it("does not render retracted cells", () => {
      expect(render({ ...cell, lifecycle: "retracted" }).body.innerHTML).toBe(
        "",
      );
    });
    it("uses the vote fallback when lifecycle is absent", () => {
      expect(
        render({
          ...cell,
          lifecycle: undefined,
          votes: { up: 0, down: 0, outdated: 4 },
        }).querySelector(".hm-badge")?.textContent,
      ).toBe("Outdated");
    });
  });
}

describe("feed interactions", () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: "https://example.test/app",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("self", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
      callback(),
    );
    container = dom.window.document.getElementById("root")!;
    root = createRoot(container);
    vi.mocked(requestJson).mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("orders cells, excludes retractions, filters by repo and opens a cell", async () => {
    const newer = {
      ...cell,
      id: "lrn_new",
      title: "New cell",
      repo: "team/api",
      lastPushedAt: "2026-10-13T10:00:00Z",
    };
    vi.mocked(requestJson).mockResolvedValue({
      learnings: [
        cell,
        {
          ...cell,
          id: "lrn_hidden",
          title: "Hidden",
          lifecycle: "retracted",
          repo: "team/hidden",
        },
        newer,
      ],
    });
    await act(async () => root.render(<Feed />));
    expect(container.querySelector("h1")?.textContent).toBe("Hive");
    expect(container.querySelectorAll("select")).toHaveLength(1);
    expect(container.textContent).not.toMatch(
      /The comb|Fresh nectar|Friction|Cell kind|Hidden|team\/hidden/,
    );
    expect(
      [...container.querySelectorAll(".hm-cell")].map((node) =>
        node.getAttribute("aria-label"),
      ),
    ).toEqual(["New cell", cell.title]);
    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = "team/web";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    expect(container.querySelectorAll(".hm-cell")).toHaveLength(1);
    await act(async () =>
      (container.querySelector(".hm-cell") as HTMLButtonElement).click(),
    );
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      cell.id,
    );
    expect(
      vi
        .mocked(requestJson)
        .mock.calls.every(
          ([path]) => path === "/api/app/feed?include_history=true",
        ),
    ).toBe(true);
  });
  it("highlights new cells for one poll update", async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce({ learnings: [cell] })
      .mockResolvedValue({ learnings: [{ ...cell, id: "lrn_new" }, cell] });
    await act(async () => root.render(<Feed />));
    expect(container.querySelector('[data-sprite="cell-filling"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(
      container.querySelectorAll('[data-sprite="cell-filling"]'),
    ).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1800));
    expect(container.querySelector('[data-sprite="cell-filling"]')).toBeNull();
  });
  it("links the empty state to Connect", async () => {
    vi.mocked(requestJson).mockResolvedValue({
      learnings: [{ ...cell, lifecycle: "retracted" }],
    });
    await act(async () => root.render(<Feed />));
    expect(
      container.querySelector(".empty-state a")?.getAttribute("href"),
    ).toBe("/app/connect");
    expect(container.querySelectorAll(".empty-state p")).toHaveLength(1);
    expect(container.textContent).toContain("0 cells");
  });
});
