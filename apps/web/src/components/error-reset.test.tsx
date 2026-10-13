import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/error-boundary";

afterEach(() => vi.unstubAllGlobals());

it("retries through reset without sending browser telemetry", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://example.test/broken?state=private#token" });
  const sendBeacon = vi.fn(() => true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("self", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("navigator", { sendBeacon });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const reset = vi.fn();
  const error = Object.assign(new Error("private exception"), { digest: "123456" });
  try {
    await act(async () => root.render(<ErrorBoundary error={error} reset={reset} />));
    await act(async () => root.render(<ErrorBoundary error={error} reset={reset} />));
    const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "Try again");
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(reset).toHaveBeenCalledOnce();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("private exception");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
