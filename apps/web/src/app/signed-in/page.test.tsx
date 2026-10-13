import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SignedInPage from "./page";

describe("public sign-in completion", () => {
  it("shows success without auth and ignores private or unrecognised query values", async () => {
    const html = renderToStaticMarkup(await SignedInPage({ searchParams: Promise.resolve({ code: "private-code", state: "private-state", client: "private-client", error: "private-error" }) }));
    expect(html).toContain("You&#x27;re signed in.");
    expect(html).toContain("npx gohive status");
    expect(html).not.toContain("private-");
  });
  it.each([["claude", "Claude Code"], ["codex", "Codex"]])("names only a known client: %s", async (client, name) => {
    const html = renderToStaticMarkup(await SignedInPage({ searchParams: Promise.resolve({ client }) }));
    expect(html).toContain(`Continue setting up Hive for ${name}`);
  });
  it("gives a retry hint for errors without claiming success", async () => {
    const html = renderToStaticMarkup(await SignedInPage({ searchParams: Promise.resolve({ error: "1", client: "claude", detail: "private-error" }) }));
    expect(html).toContain("Sign-in did not finish.");
    expect(html).toContain("npx gohive login");
    expect(html).not.toContain("private-error");
    expect(html).not.toContain("signed in.");
  });
});
