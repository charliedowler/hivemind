import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import { Login } from "./login";

vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { social: vi.fn() } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const providers = ["google", "slack", "agentid"] as const;
const names = ["Sign in with Google", "Sign in with Slack", "Sign in with AgentID"];
const query = "?invite=invite_test&client_id=cli_test&state=state_test";

async function mountLogin() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: `https://hive.example/app/login${query}` });
  const assign = vi.fn();
  vi.stubGlobal("window", new Proxy(dom.window, {
    get(target, key) {
      return key === "location" ? { origin: "https://hive.example", search: query, assign } : Reflect.get(target, key, target);
    },
  }));
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => root.render(<Login invite="" providers={[...providers]} />));
  return { container, assign, async cleanup() { await act(async () => root.unmount()); dom.window.close(); } };
}

describe.each(["Sign in", "Create a team", "Join"])("official provider buttons on %s", (tab) => {
  it.each(providers)("keeps the accessible names, local artwork and %s sign-in handler", async (provider) => {
    vi.mocked(authClient.signIn.social).mockResolvedValue({ data: { url: "https://provider.example", redirect: true }, error: null });
    const { container, assign, cleanup } = await mountLogin();
    try {
      const mode = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((button) => button.textContent === tab)!;
      await act(async () => mode.click());
      const buttons = [...container.querySelectorAll<HTMLButtonElement>(".auth-providers button")];
      expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(names);
      expect(buttons.map((button) => button.querySelector("img")!.getAttribute("src"))).toEqual([
        "/auth-providers/google.svg", "/auth-providers/slack.svg", "/auth-providers/agentid.svg",
      ]);
      expect(buttons.every((button) => button.type === "button" && button.querySelector("img")!.alt === "")).toBe(true);
      await act(async () => buttons[providers.indexOf(provider)].click());
      if (provider === "agentid") {
        expect(assign).toHaveBeenCalledExactlyOnceWith(`/api/auth/agentid/start${query}`);
        expect(authClient.signIn.social).not.toHaveBeenCalled();
      } else {
        expect(authClient.signIn.social).toHaveBeenCalledExactlyOnceWith({
          provider,
          callbackURL: `https://hive.example/app/join${query}`,
          errorCallbackURL: "https://hive.example/app/auth-error",
        });
        expect(assign).not.toHaveBeenCalled();
      }
      expect(buttons.every((button) => button.disabled)).toBe(true);
      expect(buttons[providers.indexOf(provider)].getAttribute("aria-busy")).toBe("true");
      expect(container.querySelector('[role="status"]')?.textContent).toContain("sign-in");
    } finally {
      await cleanup();
    }
  });
});

it("allows retry after a provider error without changing the button label", async () => {
  vi.mocked(authClient.signIn.social).mockRejectedValue(new Error("Sign-in is unavailable"));
  const { container, cleanup } = await mountLogin();
  try {
    const google = container.querySelector<HTMLButtonElement>('button[aria-label="Sign in with Google"]')!;
    await act(async () => google.click());
    expect(google.disabled).toBe(false);
    expect(google.getAttribute("aria-busy")).toBe("false");
    expect(google.getAttribute("aria-label")).toBe("Sign in with Google");
    expect(container.textContent).toContain("Sign-in is unavailable");
  } finally {
    await cleanup();
  }
});
