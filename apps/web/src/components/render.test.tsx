import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SearchHit } from "@hivemind/core";
import { InstallSnippets, KeyBox } from "./install";
import { LearningCard } from "./learning-card";
import { Markdown } from "./markdown";

const hit: SearchHit = {
  id: "lrn_abcdefghijkl",
  title: "Linked worktrees share one stash",
  body: "A bare `git stash pop` takes the newest entry.\n\n```sh\ngit stash list\n```",
  kind: "gotcha",
  tags: ["git", "worktrees"],
  repo: "lightdash/lightdash",
  paths: [],
  confidence: 0.9,
  source: "claude-code",
  author: { id: "mem_abcdefghijkl", name: "Charlie" },
  pushCount: 3,
  votes: { up: 2, down: 0, outdated: 1 },
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  lastPushedAt: "2026-10-12T10:00:00.000Z",
  score: 0.72,
  signals: { vector: 0.61, fts: 1, recency: 0.99, votes: 0.8, repoMatch: true },
};

describe("dashboard components", () => {
  it("renders a search hit with its metadata, signals and votes", () => {
    const html = renderToStaticMarkup(<LearningCard learning={hit} />);
    expect(html).toContain('id="lrn_abcdefghijkl"');
    expect(html).toContain("Linked worktrees share one stash");
    expect(html).toContain("Claude Code");
    expect(html).toContain("seen 3 times");
    expect(html).toContain("Score 0.72");
    expect(html).toContain("Vector 0.61");
    expect(html).toContain("Repo match");
    expect(html).toContain("<code>git stash pop</code>");
    expect(html).toContain("#worktrees");
  });

  it("turns inline learning ids into citation buttons and leaves other links alone", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text="Use the exact ref [lrn_abcdefghijkl]. See [the docs](https://example.com)."
        onCitation={() => {}}
      />,
    );
    expect(html).toContain(
      '<button class="citation">lrn_abcdefghijkl</button>',
    );
    expect(html).toContain('href="https://example.com"');
  });

  it("keeps learning ids as plain text when there is no citation handler", () => {
    const html = renderToStaticMarkup(
      <Markdown text="Seen in [lrn_abcdefghijkl]." />,
    );
    expect(html).not.toContain("<button");
    expect(html).toContain("[lrn_abcdefghijkl]");
  });

  it("fills the install snippets with the base URL and the key", () => {
    const html = renderToStaticMarkup(
      <InstallSnippets baseUrl="https://hive.example" apiKey="hm_test" />,
    );
    expect(html).toContain(
      "claude mcp add --transport http hivemind https://hive.example/api/mcp",
    );
    expect(html).toContain("Authorization: Bearer hm_test");
    expect(html).toContain(
      "codex mcp add hivemind --url https://hive.example/api/mcp --bearer-token-env-var HIVEMIND_KEY",
    );
    expect(
      renderToStaticMarkup(<InstallSnippets baseUrl="https://hive.example" />),
    ).toContain("&lt;YOUR_KEY&gt;");
  });

  it("shows the key once with a warning", () => {
    const html = renderToStaticMarkup(<KeyBox apiKey="hm_test" />);
    expect(html).toContain("hm_test");
    expect(html).toContain("Shown once");
  });
});
