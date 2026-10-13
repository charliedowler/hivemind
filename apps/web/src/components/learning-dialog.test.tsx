import { JSDOM } from "jsdom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LearningView } from "@hivemind/core";
import type { listDecisions } from "@/server/conflict-decisions";
import { LearningDetail } from "./learning-dialog";
import { requestJson } from "@/lib/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {} }),
}));

vi.mock("@/lib/client", async (original) => ({
  ...(await original<typeof import("@/lib/client")>()),
  requestJson: vi.fn(),
}));

type CellDecision = Awaited<ReturnType<typeof listDecisions>>[number];
const cell: LearningView = {
  id: "lrn_new",
  title: "Use the new port",
  body: "Use port 4000.",
  kind: "learning",
  tags: [],
  repo: "team/platform",
  paths: [],
  confidence: 0.9,
  source: "codex",
  author: { id: "mem_admin", name: "Maya" },
  pushCount: 1,
  votes: { up: 0, down: 0, outdated: 0 },
  lifecycle: "fresh",
  createdAt: "2026-10-13T10:00:00.000Z",
  updatedAt: "2026-10-13T10:00:00.000Z",
  lastPushedAt: "2026-10-13T10:00:00.000Z",
};
const record: CellDecision = {
  id: "dec_replace",
  edgeId: "sup_pair",
  reversesId: null,
  older: { id: "lrn_old", title: "Use the old port", lifecycle: "superseded" },
  newer: { id: cell.id, title: cell.title, lifecycle: "fresh" },
  decision: "supersede",
  reason: "The port changed.",
  confidence: 0.9,
  model: "jev",
  jev: null,
  latencyMs: 10,
  author: "Maya",
  repo: "team/platform",
  canReverse: true,
  canEditReason: false,
  createdAt: "2026-10-13T10:00:00.000Z",
};
let dom: JSDOM, root: Root, host: HTMLElement;
beforeEach(async () => {
  vi.clearAllMocks();
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost/app",
  });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = dom.window.document.getElementById("root")!;
  root = (await import("react-dom/client")).createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});
async function render(decisions = [record], learning = cell) {
  vi.mocked(requestJson).mockResolvedValue({ decisions });
  await act(async () => root.render(<LearningDetail learning={learning} />));
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
}
async function click(label: string) {
  expect(button(label)).toBeDefined();
  await act(async () => button(label)!.click());
}

it.each([
  ["supersede", "lrn_new", "Hive replaced Use the old port with this cell"],
  ["supersede", "lrn_old", "Hive replaced this cell with Use the new port"],
  ["keep_old", "lrn_old", "Hive merged Use the new port into this cell"],
  ["keep_old", "lrn_new", "Hive merged this cell into Use the old port"],
] as const)(
  "shows %s from %s with a cell link and time",
  async (decision, id, text) => {
    await render([{ ...record, decision }], { ...cell, id });
    const section = host.querySelector('[aria-label="Cell changes"]')!;
    expect(section.textContent).toContain(text);
    expect(section.querySelector("a")?.getAttribute("href")).toBe(
      `/app/cells/${id === "lrn_old" ? "lrn_new" : "lrn_old"}`,
    );
    expect(section.querySelector("time")?.getAttribute("datetime")).toBe(
      record.createdAt,
    );
  },
);

it.each(["member", "legacy"])("hides Reverse for a %s record", async () => {
  await render([{ ...record, canReverse: false }]);
  expect(host.textContent).toContain("Hive replaced");
  expect(button("Reverse")).toBeUndefined();
});

it("reverses once with the default reason, refreshes the cell, and allows a later note", async () => {
  await render();
  const reversed = {
    ...record,
    id: "dec_reverse",
    decision: "reversed" as const,
    reversesId: record.id,
    canEditReason: true,
    createdAt: new Date().toISOString(),
    older: { ...record.older, lifecycle: "fresh" as const },
  };
  vi.mocked(requestJson).mockImplementation(async (url, body) => {
    if (url.startsWith("/api/app/learnings/")) return cell;
    if (body && (body as { action: string }).action === "reason")
      return { record: { ...reversed, reason: "The example still applies." } };
    return { record: reversed };
  });
  await click("Reverse");
  expect(requestJson).toHaveBeenCalledWith("/api/app/conflicts", {
    id: record.id,
    action: "reverse",
    reason: "Admin requested reversal",
  });
  expect(host.textContent).toContain("Reversed just now");
  expect(button("Reverse")).toBeUndefined();
  expect(requestJson).toHaveBeenCalledWith("/api/app/learnings/lrn_new");
  await click("Add a note");
  const input = host.querySelector<HTMLInputElement>(
    'input[id="note-dec_reverse"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "The example still applies.");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
  );
  expect(requestJson).toHaveBeenCalledWith("/api/app/conflicts", {
    id: "dec_reverse",
    action: "reason",
    reason: "The example still applies.",
  });
  expect(host.textContent).toContain("Note saved.");
});

it("keeps the change visible when the server refuses stale state", async () => {
  await render();
  vi.mocked(requestJson).mockRejectedValue(
    new Error(
      "A cell has changed since then. Hive cannot safely reverse this change.",
    ),
  );
  await click("Reverse");
  expect(host.textContent).toContain("cannot safely reverse");
  expect(host.textContent).not.toContain("Reversed just now");
  expect(button("Reverse")?.disabled).toBe(false);
});

it("shows replaced, outdated and retracted related cells only after Show history", async () => {
  const outdated = {
    ...record,
    id: "dec_outdated",
    edgeId: "sup_outdated",
    decision: "mark_outdated" as const,
    older: {
      id: "lrn_outdated",
      title: "An outdated port",
      lifecycle: "outdated" as const,
    },
  };
  const merged = {
    ...record,
    id: "dec_merge",
    edgeId: "sup_merge",
    decision: "keep_old" as const,
    older: record.newer,
    newer: {
      id: "lrn_merged",
      title: "A merged port",
      lifecycle: "retracted" as const,
    },
  };
  await render([record, outdated, merged]);
  expect(host.querySelector('[aria-label="Historical cells"]')).toBeNull();
  await click("Show history");
  const history = host.querySelector('[aria-label="Historical cells"]')!;
  expect(history.textContent).toContain("Use the old port · Replaced");
  expect(history.textContent).toContain("An outdated port · Outdated");
  expect(history.textContent).toContain("A merged port · Removed");
  await click("Hide history");
  expect(host.querySelector('[aria-label="Historical cells"]')).toBeNull();
});

it("shows the latest operation after reload without offering a second reversal", async () => {
  await render([
    {
      ...record,
      id: "dec_reverse",
      decision: "reversed",
      reversesId: record.id,
      canEditReason: false,
    },
    record,
  ]);
  expect(host.textContent).toContain("Reversed");
  expect(host.textContent).not.toContain("Hive replaced");
  expect(button("Reverse")).toBeUndefined();
  expect(button("Add a note")).toBeUndefined();
});
