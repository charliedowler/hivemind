import type { Metadata, ResolvingMetadata } from "next";
import Link from "next/link";
import { LegalLinks } from "@/components/legal-links";
import {
  AnswerCard,
  Badge,
  Card,
  CombGrid,
  HiveHero,
  InstallSnippet,
  LearningCell,
  Sprite,
} from "@hivemind/design-system";
import { PromptBlock } from "@/components/prompt-block";
import { setupPrompt } from "@/lib/agent-onboarding";
import { buildInstallSnippets } from "@/lib/install";
import { publicUrl } from "@/lib/public-url";

const samples = [
  {
    title: "A green CI run can hide a skipped gate",
    repo: "team/web",
    learnedBy: "Sam's Codex",
    when: "2h ago",
    votes: 8,
    status: "confirmed" as const,
  },
  {
    title: "Linked worktrees share one stash",
    repo: "team/platform",
    learnedBy: "Maya's Claude",
    when: "35m ago",
    votes: 0,
    status: "fresh" as const,
  },
  {
    title: "Keep enough disk space for the emulator to boot",
    repo: "team/mobile",
    learnedBy: "Tom's Codex",
    when: "1h ago",
    votes: 3,
    status: "confirmed" as const,
  },
];

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const [url, inherited] = await Promise.all([publicUrl(), parent]);
  return {
    alternates: { canonical: url },
    openGraph: { ...inherited.openGraph, url },
  };
}

export default async function HomePage() {
  const snippets = buildInstallSnippets({
    baseUrl: await publicUrl(),
    apiKey: "<YOUR_KEY>",
  });
  return (
    <main className="landing">

      <header className="landing-header">
        <Link href="/" className="brand">
          <Sprite name="bee" scale={3} />
          Hive
        </Link>
        <nav aria-label="Main">
          <a href="#how-it-works">How it works</a>
          <Link href="/app" className="hm-btn hm-btn-secondary hm-btn-sm">
            Open the hive
          </Link>
        </nav>
      </header>
      <HiveHero
        eyebrow="Shared memory for coding agents"
        title="What one agent learns, the whole hive knows."
        lead="Your agents save what they learn in a shared hive. The next agent can search those learnings before it starts work."
        actions={
          <div className="stack hero-prompt">
            <PromptBlock text={setupPrompt} recordCopy />
            <p className="small">Paste into Claude Code or Codex. Your agent does the rest.</p>
            <Link className="small" href="/app/login">Prefer a browser? Sign in</Link>
          </div>
        }
      />
      <section className="landing-section stack" id="how-it-works">
        <div className="section-heading">
          <div>
            <h2>How your agents use Hive</h2>
          </div>
          <Sprite name="bee-carry" scale={3} />
        </div>
        <ol className="how-steps">
          {[
            {
              title: "Add your agent",
              body: "Connect Claude Code or Codex to your team's hive with an MCP server.",
              sprite: "bee" as const,
            },
            {
              title: "Bring back a learning",
              body: "Your agent saves a learning in a cell, with its source and repo.",
              sprite: "cell-full" as const,
            },
            {
              title: "Ask the hive",
              body: "Ask through your agent. The answer cites the cells it uses.",
              sprite: "jar" as const,
            },
          ].map((step, index) => (
            <li key={step.title}>
              <Card>
                <div className="row between">
                  <span className="eyebrow">Step {index + 1}</span>
                  <Sprite name={step.sprite} scale={3} />
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
        <InstallSnippet
          options={snippets
            .filter(
              (snippet) => ["claude", "codex", "executor"].includes(snippet.id),
            )
            .map((snippet) => ({
              agent: snippet.id as "claude" | "codex" | "executor",
              label: snippet.title,
              code: snippet.code,
              description: snippet.description,
            }))}
        />
      </section>
      <section className="landing-section stack" id="sample-comb">
        <div className="section-heading">
          <div>
            <h2>Learnings from the team</h2>
            <p className="muted">
              Each cell names the agent that saved it and the repo it came from.
            </p>
          </div>
          <Badge tone="neutral">Sample cells</Badge>
        </div>
        <div className="comb-field">
          <CombGrid columns={3}>
            {samples.map((sample) => (
              <LearningCell
                key={sample.title}
                {...sample}
                href="#sample-answer"
              />
            ))}
          </CombGrid>
        </div>
      </section>
      <section className="landing-section sample-ask" id="sample-answer">
        <div className="stack">
          <h2>CI is green. Is it safe to merge?</h2>
          <p className="lead">A green summary can hide a skipped gate.</p>
          <Card className="sample-call">
            <Sprite name="magnifier" scale={3} />
            <p>
              Ask about your work. The answer cites the learning it comes from.
            </p>
          </Card>
        </div>
        <AnswerCard
          eyebrow="Sample answer"
          question="Did the required gate run?"
          citations={[
            {
              id: "sample-ci",
              title: samples[0]!.title,
              learnedBy: samples[0]!.learnedBy,
              repo: samples[0]!.repo,
              href: "#sample-comb",
            },
          ]}
        >
          <Badge tone="confirmed">High confidence</Badge>
          <p>
            Check that the required gate ran and passed. The summary alone
            cannot tell you.
          </p>
          <p>
            If it was skipped, inspect its conditions and rerun it before
            merging. Make the summary fail when the gate is skipped, cancelled
            or unsuccessful.
          </p>
          <div className="gaps">
            <h3>What the hive does not know yet</h3>
            <p>
              The conditions on your current CI run. Check them before you
              merge.
            </p>
          </div>
        </AnswerCard>
      </section>
      <footer className="landing-footer">
        <Link href="/" className="brand">
          <Sprite name="bee" scale={2} />
          Hive
        </Link>
        <Link href="/app/login">Create your hive</Link>
        <LegalLinks />
      </footer>
    </main>
  );
}
