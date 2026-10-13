import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DescribeRule } from "./capture-rules";

const fixture = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  active: false,
  requestJson: vi.fn(),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useRef: (initial: unknown) => {
      if (!fixture.active) return react.useRef(initial);
      const index = fixture.cursor++;
      if (!(index in fixture.states)) fixture.states[index] = { current: initial };
      return fixture.states[index];
    },
    useState: (initial: unknown) => {
      if (!fixture.active) return react.useState(initial);
      const index = fixture.cursor++;
      if (!(index in fixture.states)) fixture.states[index] = initial;
      return [
        fixture.states[index],
        (value: unknown) => {
          fixture.states[index] =
            typeof value === "function" ? value(fixture.states[index]) : value;
        },
      ];
    },
  };
});
vi.mock("@/lib/client", async (original) => ({
  ...(await original<typeof import("@/lib/client")>()),
  requestJson: fixture.requestJson,
}));

function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
}

function mount() {
  const onSaved = vi.fn(async () => {});
  const onCancel = vi.fn();
  function render() {
    fixture.cursor = 0;
    fixture.active = true;
    try {
      return DescribeRule({ onSaved, onCancel });
    } finally {
      fixture.active = false;
    }
  }
  function find(
    tree: ReactNode,
    predicate: (node: ReactElement<Record<string, unknown>>) => boolean,
  ) {
    const found = nodes(tree).find(predicate);
    if (!found) throw new Error("Control not found.");
    return found;
  }
  async function submit(text: string) {
    const textarea = find(render(), (node) => node.type === "textarea");
    (textarea.props.onChange as Function)({ target: { value: text } });
    const form = find(render(), (node) => node.type === "form");
    (form.props.onSubmit as Function)({ preventDefault() {} });
    await vi.waitFor(() => expect(fixture.states[2]).toBe(false));
    return render();
  }
  return { render, submit, find, onSaved, onCancel };
}

const saved = {
  status: "saved",
  restatement: "Exclude repos outside team.",
  undoUntil: "2026-10-13T11:00:00Z",
  counts: {
    scanned: 12,
    matched: 5,
    applied: 4,
    skipped: 1,
    restored: 0,
    retained: 0,
    pending: true,
  },
};
const undone = {
  status: "undone",
  restatement: "Removed your latest rule.",
  counts: {
    scanned: 4,
    matched: 4,
    applied: 0,
    skipped: 0,
    restored: 3,
    retained: 1,
    pending: false,
  },
};

beforeEach(() => {
  fixture.states = [];
  fixture.cursor = 0;
  fixture.active = false;
  fixture.requestJson.mockReset();
});

describe("direct capture instruction interactions", () => {
  it("saves on one submit, refreshes the rules, and keeps the result and input open", async () => {
    fixture.requestJson.mockResolvedValueOnce(saved);
    const ui = mount();
    const tree = await ui.submit("  Exclude repos outside team  ");
    expect(fixture.requestJson).toHaveBeenCalledExactlyOnceWith(
      "/api/app/capture-rules/propose",
      { text: "Exclude repos outside team" },
    );
    expect(ui.onSaved).toHaveBeenCalledOnce();
    expect(ui.onCancel).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(saved.restatement);
    expect(html).toContain("Reply undo to remove it.");
    expect(html).toContain("More existing cells still need to be checked.");
    expect(html).toContain("Undo latest rule");
    expect(html).toContain("textarea");
    expect(html).not.toContain("Confirm");
    expect(html).not.toContain("Review the proposal");
  });
  it("asks for a missing detail and saves the reply without a confirmation", async () => {
    fixture.requestJson
      .mockResolvedValueOnce({
        status: "question",
        restatement: "Exclude repos outside work.",
        question: "Which repository owner?",
      })
      .mockResolvedValueOnce(saved);
    const ui = mount();
    const question = await ui.submit("Exclude repos outside work");
    expect(ui.onSaved).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(question);
    expect(html).toContain("Which repository owner?");
    expect(html).toContain("Your reply");
    expect(html).toContain(">Reply<");
    expect(html).not.toContain("Undo latest rule");
    await ui.submit("team");
    expect(fixture.requestJson).toHaveBeenLastCalledWith(
      "/api/app/capture-rules/propose",
      { text: "Exclude repos outside work\nRequired detail: team" },
    );
    expect(ui.onSaved).toHaveBeenCalledOnce();
  });
  it("preserves tentative wording when sending the required detail", async () => {
    fixture.requestJson.mockResolvedValue({
      status: "question",
      restatement: "A repository owner is missing.",
      question: "Which repository owner?",
    });
    const ui = mount();
    await ui.submit("Maybe exclude repos outside work?");
    await ui.submit("lightdash");
    expect(fixture.requestJson).toHaveBeenLastCalledWith(
      "/api/app/capture-rules/propose",
      {
        text: "Maybe exclude repos outside work?\nRequired detail: lightdash",
      },
    );
    expect(ui.onSaved).not.toHaveBeenCalled();
  });
  it("sends typed undo without the outstanding clarification context", async () => {
    fixture.requestJson
      .mockResolvedValueOnce({
        status: "question",
        restatement: "Exclude repos outside work.",
        question: "Which repository owner?",
      })
      .mockResolvedValueOnce(undone);
    const ui = mount();
    await ui.submit("Exclude repos outside work");
    await ui.submit("undo");
    expect(fixture.requestJson).toHaveBeenLastCalledWith(
      "/api/app/capture-rules/propose",
      { text: "undo" },
    );
    expect(ui.onSaved).toHaveBeenCalledOnce();
  });
  it("supports undo typed in the same field and shows restored and retained counts", async () => {
    fixture.requestJson
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce(undone);
    const ui = mount();
    await ui.submit("Exclude repos outside team");
    const tree = await ui.submit("undo");
    expect(fixture.requestJson).toHaveBeenLastCalledWith(
      "/api/app/capture-rules/propose",
      { text: "undo" },
    );
    expect(ui.onSaved).toHaveBeenCalledTimes(2);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("3 cells restored; 1 kept as they are");
    expect(html).not.toContain("Reply undo to remove it.");
    expect(html).not.toContain("Undo latest rule");
  });
  it("undoes with an accessible action immediately, without a confirmation", async () => {
    fixture.requestJson
      .mockResolvedValueOnce(saved)
      .mockResolvedValueOnce(undone);
    const ui = mount();
    const tree = await ui.submit("Exclude repos outside team");
    const button = ui.find(
      tree,
      (node) => node.props.children === "Undo latest rule",
    );
    (button.props.onClick as Function)();
    await vi.waitFor(() => expect(fixture.states[2]).toBe(false));
    expect(fixture.requestJson).toHaveBeenLastCalledWith(
      "/api/app/capture-rules/undo",
      {},
    );
    expect(ui.onSaved).toHaveBeenCalledTimes(2);
    expect(renderToStaticMarkup(ui.render())).toContain(undone.restatement);
  });
  it("shows an undo failure without claiming a restoration or clearing the saved result", async () => {
    fixture.requestJson
      .mockResolvedValueOnce(saved)
      .mockRejectedValueOnce(new Error("The undo window has expired."));
    const ui = mount();
    await ui.submit("Exclude repos outside team");
    const tree = await ui.submit("undo");
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("The undo window has expired.");
    expect(html).toContain(saved.restatement);
    expect(html).not.toContain("cells restored");
    expect(ui.onSaved).toHaveBeenCalledOnce();
  });
});
