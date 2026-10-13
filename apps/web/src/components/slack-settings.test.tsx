import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SlackSettings } from "./slack-settings";
import type { SlackSettingsData } from "@/server/slack/store";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/client", () => ({
  requestJson: request,
  errorMessage: (error: Error) => error.message,
  relativeTime: () => "2 minutes ago",
}));
const initial: SlackSettingsData = {
  installation: {
    active: true,
    workspaceName: "Test workspace",
    workspaceId: "T1",
  },
  channels: [
    {
      id: "C1",
      name: "engineering",
      private: true,
      state: "enabled",
      count: 12,
      botMember: true,
      backfillDone: true,
      error: null,
    },
  ],
  decisions: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function mount(debug = false, data = initial, disabled = false) {
  const dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <fieldset disabled={disabled}>
        <SlackSettings initial={data} debug={debug} />
      </fieldset>,
    ),
  );
  return {
    host,
    button: (text: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === text)!,
    close: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}
it.each([false, true])(
  "shows the decision card only in debug mode (%s)",
  async (debug) => {
    const { host, close } = await mount(debug);
    try {
      expect(host.textContent?.includes("When Hive speaks")).toBe(debug);
      expect(host.textContent).not.toMatch(
        /Refresh channels|Retry pending work|Digests/,
      );
      expect(host.querySelector('a[href*="digests"]')).toBeNull();
      expect(host.textContent).toContain("Connected to Test workspace");
      expect(host.textContent).toContain(
        "Ask @Hive in a channel for a weekly update.",
      );
    } finally {
      await close();
    }
  },
);
it("keeps Stop, Purge and Disconnect consequences and their requests", async () => {
  request.mockResolvedValue(initial);
  const { host, button, close } = await mount();
  try {
    expect(host.textContent).toContain(
      "Stop indexing keeps existing messages searchable.",
    );
    expect(host.textContent).toContain(
      "Disconnect stops replies and ingestion.",
    );
    await act(async () => button("Stop indexing").click());
    expect(request).toHaveBeenLastCalledWith("/api/app/slack", {
      action: "stop",
      channel: "C1",
    });
    await act(async () => button("Purge messages").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Saved cells remain in Hive.",
    );
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => button("Purge this channel").click());
    expect(request).toHaveBeenLastCalledWith("/api/app/slack", {
      action: "purge",
      channel: "C1",
    });
    await act(async () => button("Disconnect Slack").click());
    expect(request).toHaveBeenLastCalledWith("/api/app/slack", {
      action: "disconnect",
      channel: undefined,
    });
  } finally {
    await close();
  }
});
it("disables every Slack action for a member", async () => {
  const { host, button, close } = await mount(false, initial, true);
  try {
    expect(
      [...host.querySelectorAll("button")].every((b) => b.matches(":disabled")),
    ).toBe(true);
    await act(async () => button("Stop indexing").click());
    expect(request).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});
it("explains automatic discovery for an empty channel list", async () => {
  const { host, close } = await mount(false, { ...initial, channels: [] });
  try {
    expect(host.textContent).toContain("It appears here within 15 minutes.");
  } finally {
    await close();
  }
});
it("keeps the connection control when Slack is disconnected", async () => {
  const { button, close } = await mount(false, {
    ...initial,
    installation: null,
  });
  try {
    expect(button("Connect Slack")).toBeDefined();
  } finally {
    await close();
  }
});
