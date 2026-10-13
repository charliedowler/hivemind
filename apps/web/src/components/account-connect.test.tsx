import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Account } from "./account";
import { InstallPage } from "./install";

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}));
vi.mock("@/lib/client", () => ({
  requestJson: mocks.request,
  errorMessage: (error: Error) => error.message,
}));
vi.mock("./password-reset", () => ({
  PasswordReset: () => (
    <form aria-label="Password">
      <input name="password" />
    </form>
  ),
}));
vi.mock("./email-code", () => ({
  EmailCode: ({ onVerified }: { onVerified: () => void }) => (
    <button onClick={onVerified}>Verify code</button>
  ),
}));
const account = {
  member: {
    name: "Test member",
    email: "member@example.test",
    email_verified: true,
    role: "member",
  },
};
const key = {
  id: "key_test",
  label: "CI agent",
  prefix: "hm_prefix",
  created_at: "2026-10-12T12:00:00Z",
  last_used_at: null,
  revoked_at: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function render(node: ReactNode, stored?: string) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost/app/account",
  });
  for (const name of [
    "window",
    "self",
    "document",
    "FormData",
    "Event",
    "localStorage",
  ] as const)
    vi.stubGlobal(name, dom.window[name]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  if (stored) dom.window.localStorage.setItem("hive.install.client.v1", stored);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    dom,
    root,
    close: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}
function button(container: HTMLElement, text: string) {
  return [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  )!;
}

it.each(["social-only", "agent"])(
  "hides password controls for a %s account",
  async () => {
    const { container, close } = await render(
      <Account rules={[]} initial={account} hasPassword={false} />,
    );
    try {
      expect(container.querySelector('input[name="password"]')).toBeNull();
      expect(container.textContent).not.toContain("Change password");
      expect(container.querySelectorAll("form")).toHaveLength(2);
      expect(container.textContent).toContain(account.member.email);
      expect(container.textContent).not.toContain("Create a key");
      expect(container.querySelector('input[name="label"]')).toBeNull();
    } finally {
      await close();
    }
  },
);

it("offers a collapsed password form only for a credential account", async () => {
  const { container, close } = await render(
    <Account rules={[]} initial={account} hasPassword />,
  );
  try {
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector('input[name="password"]')).not.toBeNull();
  } finally {
    await close();
  }
});

it("reveals email change on request and closes it after verification", async () => {
  mocks.request.mockResolvedValue(account);
  const { container, dom, close } = await render(
    <Account rules={[]} initial={account} hasPassword={false} />,
  );
  try {
    expect(container.querySelector('input[name="email"]')).toBeNull();
    await act(async () => button(container, "Change email").click());
    const email = container.querySelector<HTMLInputElement>(
      'input[name="email"]',
    )!;
    expect(email.value).toBe(account.member.email);
    email.value = "new@example.test";
    mocks.request.mockResolvedValueOnce({
      verificationToken: "test-verification",
    });
    await act(async () =>
      email.form!.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(mocks.request).toHaveBeenCalledWith("/api/app/email", {
      email: "new@example.test",
      memberName: "Test member",
      intent: "account",
    });
    await act(async () => button(container, "Verify code").click());
    expect(container.querySelector('input[name="email"]')).toBeNull();
    expect(
      button(container, "Change email").getAttribute("aria-expanded"),
    ).toBe("false");
  } finally {
    await close();
  }
});

it("puts collapsed keys below the installer and preserves creation and revocation", async () => {
  const { container, dom, close } = await render(
    <InstallPage baseUrl="https://example.test" initialKeys={[key]} />,
  );
  try {
    const details = container.querySelector("details")!;
    expect(details.querySelector("summary")?.textContent).toBe(
      "Keys for CI and headless setups",
    );
    expect(details.open).toBe(false);
    expect(container.textContent!.indexOf("npx gohive install")).toBeLessThan(
      container.textContent!.indexOf("Keys for CI"),
    );
    const label = container.querySelector<HTMLInputElement>(
      'input[name="label"]',
    )!;
    label.value = "Build agent";
    mocks.request
      .mockResolvedValueOnce({ apiKey: "hm_test_revealed_once" })
      .mockResolvedValueOnce({ keys: [key] });
    await act(async () =>
      label.form!.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(mocks.request).toHaveBeenCalledWith("/api/app/keys", {
      label: "Build agent",
    });
    expect(container.textContent).toContain("hm_test_revealed_once");
    expect(button(container, "Copy key")).toBeDefined();
    mocks.request.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      keys: [{ ...key, revoked_at: "2026-10-13T12:00:00Z" }],
    });
    await act(async () => button(container, "Revoke key").click());
    expect(mocks.request).toHaveBeenCalledWith("/api/app/admin", {
      action: "revoke",
      id: key.id,
    });
    expect(button(container, "Revoked").disabled).toBe(true);
  } finally {
    await close();
  }
});

it.each(["codex", "executor", "invalid"])(
  "restores the saved %s client with a safe fallback",
  async (stored) => {
    const { container, dom, close } = await render(
      <InstallPage baseUrl="https://example.test" />,
      stored,
    );
    try {
      const selected = container.querySelector(
        '[role="tablist"][aria-label="Agent"] [role="tab"][aria-selected="true"]',
      )!;
      expect(selected.textContent).toBe(
        stored === "codex"
          ? "Codex"
          : stored === "executor"
            ? "Executor"
            : "Claude Code",
      );
      const tabs = container.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="Agent"] [role="tab"]',
      );
      await act(async () => tabs[1].click());
      expect(dom.window.localStorage.getItem("hive.install.client.v1")).toBe(
        "codex",
      );
      await act(async () =>
        tabs[1].dispatchEvent(
          new dom.window.KeyboardEvent("keydown", {
            key: "ArrowRight",
            bubbles: true,
          }),
        ),
      );
      expect(dom.window.localStorage.getItem("hive.install.client.v1")).toBe(
        "executor",
      );
      expect(dom.window.document.activeElement).toBe(tabs[2]);
    } finally {
      await close();
    }
  },
);

it("keeps client tabs usable when local storage is blocked", async () => {
  const { container, dom, close } = await render(
    <InstallPage baseUrl="https://example.test" />,
  );
  const get = vi
    .spyOn(dom.window.Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("Storage blocked");
    });
  const set = vi
    .spyOn(dom.window.Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage blocked");
    });
  try {
    const tabs = container.querySelectorAll<HTMLButtonElement>(
      '[role="tablist"][aria-label="Agent"] [role="tab"]',
    );
    await act(async () => tabs[1].click());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(
      container
        .querySelector('[role="tablist"][aria-label="Agent"]')
        ?.parentElement?.querySelector('[role="tabpanel"]')?.textContent,
    ).toContain("codex mcp add");
  } finally {
    get.mockRestore();
    set.mockRestore();
    await close();
  }
});
