import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@hivemind/core";
import { CombGrid } from "@hivemind/design-system";
import { InstallPage, InstallSnippets, KeyBox } from "./install";
import { LearningCard, SearchHitCard } from "./learning-card";
import { LearningDetail } from "./learning-dialog";
import { Markdown } from "./markdown";
import { learningStatus } from "@/lib/learning-presentation";
import { Login } from "./login";
import { enabledSignInProviders } from "@/lib/auth-providers";


vi.mock("@/lib/measurement-consent", () => ({ useMeasurementConsent: () => false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {} }),
}));

const hit: SearchHit = {
  id: "lrn_abcdefghijkl",
  title: "Linked worktrees share one stash",
  body: "A bare `git stash pop` takes the newest entry.\n\n```sh\ngit stash list\n```",
  kind: "gotcha",
  tags: ["git", "worktrees"],
  repo: "team/platform",
  paths: ["src/git.ts"],
  confidence: 0.9,
  source: "claude-code",
  author: { id: "mem_abcdefghijkl", name: "Maya" },
  pushCount: 3,
  captureFlagged: false,
  captureRedacted: false,
  captureRuleIds: [],
  votes: { up: 2, down: 0, outdated: 1 },
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  lastPushedAt: "2026-10-12T10:00:00.000Z",
  score: 0.72,
  signals: { vector: 0.61, fts: 1, recency: 0.99, votes: 0.8, repoMatch: true },
};

describe("dashboard components", () => {
  it("hides unconfigured providers and removes API keys from web sign-in", () => {
    const providers = enabledSignInProviders({
      GOOGLE_CLIENT_ID: "fixture",
      SLACK_CLIENT_SECRET: "fixture",
    });
    expect(providers).toEqual([]);
    const html = renderToStaticMarkup(
      <Login invite="" providers={providers} />,
    );
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).not.toContain('name="apiKey"');
    expect(html).not.toContain("Sign in with Google");
    expect(html).not.toContain("Sign in with Slack");
    const configured = renderToStaticMarkup(
      <Login
        invite=""
        providers={enabledSignInProviders({
          GOOGLE_CLIENT_ID: "fixture",
          GOOGLE_CLIENT_SECRET: "fixture",
          SLACK_CLIENT_ID: "fixture",
          SLACK_CLIENT_SECRET: "fixture",
        })}
      />,
    );
    expect(configured).toContain("Sign in with Google");
    expect(configured).toContain("Sign in with Slack");
  });
  it("renders a keyboard reachable cell with attribution, status and repeat pushes", () => {
    const html = renderToStaticMarkup(
      <CombGrid columns={4}>
        <LearningCard learning={hit} onOpen={() => {}} highlighted />
      </CombGrid>,
    );
    expect(html).toContain("hm-comb-4");
    expect(html).toContain('type="button" class="hm-cell hm-cell-confirmed"');
    expect(html).toContain('aria-label="Linked worktrees share one stash"');
    expect(html).toContain("Maya&#x27;s Claude");
    expect(html).toContain("Seen 3 times");
    expect(html).toContain('data-sprite="cell-filling"');
  });

  it("maps status from votes and repeat pushes", () => {
    expect(
      learningStatus({ votes: { up: 0, down: 0, outdated: 0 }, pushCount: 1 }),
    ).toBe("fresh");
    expect(
      learningStatus({ votes: { up: 0, down: 0, outdated: 0 }, pushCount: 2 }),
    ).toBe("confirmed");
    expect(
      learningStatus({ votes: { up: 1, down: 0, outdated: 1 }, pushCount: 1 }),
    ).toBe("confirmed");
    expect(
      learningStatus({ votes: { up: 1, down: 0, outdated: 2 }, pushCount: 3 }),
    ).toBe("outdated");
  });

  it("shows the search score and all ranking signals without opening the cell", () => {
    const html = renderToStaticMarkup(
      <SearchHitCard hit={hit} onOpen={() => {}} />,
    );
    expect(html).toContain('id="lrn_abcdefghijkl"');
    expect(html).toContain("Score 0.72");
    for (const signal of [
      "Vector",
      "0.61",
      "Text",
      "1.00",
      "Recency",
      "0.99",
      "Votes",
      "0.80",
      "Repo",
      "match",
    ])
      expect(html).toContain(signal);
    expect(html).toContain("worktrees");
    expect(html).toContain("Maya&#x27;s Claude");
  });

  it("renders full markdown, paths, kind, votes and a copyable id inside a learning", () => {
    const html = renderToStaticMarkup(<LearningDetail learning={hit} />);
    expect(html).toContain("Seen 3 times");
    expect(
      renderToStaticMarkup(
        <LearningDetail learning={{ ...hit, pushCount: 1 }} />,
      ),
    ).not.toContain("Seen ");
    expect(html).toContain("gotcha");
    expect(html).toContain("src/git.ts");
    expect(html).toContain("<code>git stash pop</code>");
    for (const action of [
      "Useful, 2 votes",
      "Unhelpful, 0 votes",
      "Outdated, 1 votes",
      "Copy id",
    ])
      expect(html).toContain(action);
    expect(html).toContain("lrn_abcdefghijkl");
  });

  it("shows kept status only for a current cell with capture-rule evidence", () => {
    const kept = renderToStaticMarkup(
      <LearningDetail learning={{ ...hit, captureRuleIds: ["crule_test"] }} />,
    );
    expect(kept).toContain("kept after owner confirmation");
    expect(
      renderToStaticMarkup(<LearningDetail learning={hit} />),
    ).not.toContain("kept after owner confirmation");
    expect(
      renderToStaticMarkup(
        <LearningDetail
          learning={{
            ...hit,
            lifecycle: "retracted",
            captureRuleIds: ["crule_test"],
          }}
        />,
      ),
    ).not.toContain("kept after owner confirmation");
  });
  it("turns inline learning ids into citation buttons and leaves other links alone", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text="Use the exact ref [lrn_abcdefghijkl]. See [the source](https://example.com)."
        onCitation={() => {}}
      />,
    );
    expect(html).toContain('href="/app/cells/lrn_abcdefghijkl"');
    expect(html).toContain('href="https://example.com"');
  });

  it("links unresolved cell citations without exposing ids as chip text", () => {
    const html = renderToStaticMarkup(
      <Markdown text="Seen in [lrn_abcdefghijkl]." />,
    );
    expect(html).not.toContain("<button");
    expect(html).toContain('href="/app/cells/lrn_abcdefghijkl"');
    expect(html).toContain(">Open cell</a>");
    expect(html).not.toContain(">lrn_abcdefghijkl</a>");
  });

  it("shows supersession and expiry despite earlier useful votes", () => {
    const cell = {
      ...hit,
      lifecycle: "superseded" as const,
      supersededBy: "lrn_replacement",
      verifyBeforeUse: true,
      revision: 2,
    };
    const html = renderToStaticMarkup(<LearningDetail learning={cell} />);
    expect(learningStatus(cell)).toBe("outdated");
    expect(html).toContain("Superseded by");
    expect(html).toContain('href="/app/cells/lrn_replacement"');
    expect(html).toContain("Verify before use");
    expect(html).toContain("Show history");
  });


  it("leads with the npm installer and keeps manual setup available", () => {
    const html = renderToStaticMarkup(<InstallPage baseUrl="https://hive.example" />);
    expect(html.indexOf("npx gohive install")).toBeLessThan(html.indexOf("claude mcp add"));
    expect(html).toContain("npx gohive install");
    expect(html).not.toContain("Install from Git while the npm package is awaiting publication");
    expect(html).not.toContain("github:charliedowler/hivemind gohive install");
    expect(html).toContain("skills/hive/SKILL.md");
    expect(html).toContain("Manual setup for Claude Code, Codex or Executor");
    expect(html).toContain("npx gohive doctor");
  });

  it("keeps OAuth commands and the headless key fallback last", () => {
    const html = renderToStaticMarkup(
      <InstallSnippets baseUrl="https://hive.example" apiKey="hm_test" />,
    );
    expect(html).toContain(
      "claude mcp add --transport http hive https://hive.example/api/mcp",
    );
    expect(html).toContain("Authorization: Bearer hm_test");
    expect(html).toContain(
      "codex mcp add hive --url https://hive.example/api/mcp --bearer-token-env-var HIVE_KEY",
    );
    expect(html).toContain("Executor");
    expect(html).toContain('role="tab"');
    expect(html).not.toContain("One line.");
    expect(html).toContain("Agent instructions");
    expect(html).toContain("claude mcp list");
    expect(
      renderToStaticMarkup(<InstallSnippets baseUrl="https://hive.example" />),
    ).toContain("&lt;YOUR_KEY&gt;");
  });

  it("shows the key once with a warning", () => {
    const html = renderToStaticMarkup(<KeyBox apiKey="hm_test" />);
    expect(html).toContain("hm_test");
    expect(html).toContain("Shown once");
    expect(html).toContain("cannot show it again");
  });
});
