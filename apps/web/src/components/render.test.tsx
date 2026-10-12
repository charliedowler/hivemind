import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SearchHit } from "@hivemind/core";
import { AnswerCard, CombGrid } from "@hivemind/design-system";
import { InstallSnippets, KeyBox } from "./install";
import { LearningCard, SearchHitCard } from "./learning-card";
import { LearningDetail } from "./learning-dialog";
import { FrictionContent } from "./friction-panel";
import { ConflictCard } from "./conflicts-panel";
import { Markdown } from "./markdown";
import { learningStatus } from "@/lib/learning-presentation";

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
  votes: { up: 2, down: 0, outdated: 1 },
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  lastPushedAt: "2026-10-12T10:00:00.000Z",
  score: 0.72,
  signals: { vector: 0.61, fts: 1, recency: 0.99, votes: 0.8, repoMatch: true },
};

describe("dashboard components", () => {
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
    expect(html).toContain("seen 3 times");
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

  it("renders clickable cited cells with attribution", () => {
    const html = renderToStaticMarkup(
      <AnswerCard
        question="How do worktrees share a stash?"
        citations={[
          {
            id: hit.id,
            title: hit.title,
            learnedBy: "Maya's Claude",
            repo: hit.repo!,
            onClick: () => {},
          },
        ]}
      >
        <Markdown text="Use an exact stash ref." />
      </AnswerCard>,
    );
    expect(html).toContain('class="hm-cite"');
    expect(html).toContain("Cited cells");
    expect(html).toContain("Maya&#x27;s Claude");
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

  it("shows titles in inline citations when answer sources are available", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text="Check the gate [lrn_abcdefghijkl]."
        onCitation={() => {}}
        citations={[{ id: hit.id, title: hit.title }]}
      />,
    );
    expect(html).toContain(`>${hit.title}</a>`);
    expect(html).not.toContain(">lrn_abcdefghijkl</button>");
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

  it("shows friction titles and keeps ids in tooltips", () => {
    const html = renderToStaticMarkup(
      <FrictionContent
        data={{
          since: hit.createdAt,
          count: 1,
          minutes: 7,
          unmeasured: 0,
          blocked: 0,
          areas: [{ area: "tool", count: 1, minutes: 7, ids: [hit.id] }],
          recurring: [],
          cells: [{ id: hit.id, title: hit.title }],
        }}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain(`>${hit.title}</a>`);
    expect(html).toContain(`title="${hit.title} (${hit.id})"`);
    expect(html).not.toContain(`>${hit.id}</a>`);
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
    expect(html).toContain("Show version history");
  });

  it("disables acceptance of a conflict after a source changes", () => {
    const html = renderToStaticMarkup(
      <ConflictCard
        conflict={{
          id: "edge",
          older: {
            id: hit.id,
            title: hit.title,
            body: hit.body,
            author: "Maya",
            revision: 1,
          },
          newer: {
            id: "lrn_replacement",
            title: "Use an explicit stash ref",
            body: "Check the stash list first.",
            author: "Sam",
            revision: 1,
          },
          relation: "update",
          confidence: 0.9,
          status: "candidate",
          reason: "Changed guidance",
          votes: 0,
          voted: false,
          canAdmin: true,
          stale: true,
          createdAt: hit.createdAt,
        }}
        onOpen={() => {}}
        onDecision={() => {}}
      />,
    );
    expect(html).toContain("A source changed");
    expect(html).toMatch(/disabled=""[^>]*>Confirm replacement/);
    expect(html).toContain("Keep both cells");
  });

  it("fills the unchanged install snippets with the base URL and key", () => {
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
    expect(html).toContain("Run this command in your terminal to connect your agent.");
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
