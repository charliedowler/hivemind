import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Navigation } from "./navigation";

const mocks = vi.hoisted(() => ({ request: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/team",
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/app/app/actions", () => ({ signOutAndContinue: vi.fn() }));
vi.mock("@/lib/client", () => ({
  requestJson: mocks.request,
  errorMessage: (error: Error) => error.message,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderNavigation(teamCount: number) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/app/team" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("AbortController", dom.window.AbortController);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => root.render(<Navigation teamName="Test team" memberName="Test member" teamCount={teamCount} />));
  return { dom, container, close: async () => {
    await act(async () => root.unmount());
    dom.window.close();
  } };
}

it.each([1, 2])("shows three links and restricts Switch team for %i memberships", async (teamCount) => {
  const { dom, container, close } = await renderNavigation(teamCount);
  try {
    expect([...container.querySelectorAll("nav a")].map((link) => link.textContent)).toEqual(["Hive", "Team", "Connect"]);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Team");
    const avatar = container.querySelector<HTMLButtonElement>('[aria-label="Account menu"]')!;
    expect(container.textContent).not.toContain("Sign out");
    await act(async () => avatar.click());
    expect(avatar.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Test member");
    expect(container.textContent).toContain("Test team");
    expect(container.textContent).toContain("Sign out");
    expect(container.querySelector('a[href="/app/account"]')).not.toBeNull();
    expect(container.textContent?.includes("Switch team")).toBe(teamCount > 1);
    await act(async () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" })));
    expect(avatar.getAttribute("aria-expanded")).toBe("false");
    expect(dom.window.document.activeElement).toBe(avatar);
    await act(async () => avatar.click());
    await act(async () => dom.window.document.body.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
    expect(avatar.getAttribute("aria-expanded")).toBe("false");
  } finally { await close(); }
});

it("keeps a failed sign-out visible and only leaves after the session clears", async () => {
  const { container, close } = await renderNavigation(1);
  try {
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Account menu"]')!.click());
    const signOut = [...container.querySelectorAll("button")].find((button) => button.textContent === "Sign out")!;
    mocks.request.mockRejectedValueOnce(new Error("Try again."));
    await act(async () => signOut.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Try again.");
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.request.mockResolvedValueOnce(undefined);
    await act(async () => signOut.click());
    expect(mocks.request).toHaveBeenLastCalledWith("/api/app/session", undefined, undefined, "DELETE");
    expect(mocks.push).toHaveBeenCalledWith("/app/login");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  } finally { await close(); }
});
