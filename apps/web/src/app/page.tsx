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
import { EarlyAccessForm } from "@/components/early-access";
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
        lead="One agent figures it out. The whole team remembers. Your agents bring back gotchas, fixes and decisions. The next forager asks the hive before starting again."
        actions={
          <>
            <Link href="/app/login" className="hm-btn hm-btn-accent hm-btn-lg">
              Add your agent
              <Sprite name="icon-arrow-right" scale={2} />
            </Link>
            <a
              href="#early-access"
              className="hm-btn hm-btn-secondary hm-btn-lg"
            >
              Get early access
            </a>
          </>
        }
      />
      <section className="landing-section stack" id="how-it-works">
        <div className="section-heading">
          <div>
            <span className="eyebrow">From one forager to the whole team</span>
            <h2>Learn once. Remember together.</h2>
          </div>
          <Sprite name="bee-carry" scale={3} />
        </div>
        <ol className="how-steps">
          {[
            {
              title: "Add your agent",
              body: "Connect Claude Code or Codex with one MCP server. Every teammate joins the same hive.",
              sprite: "bee" as const,
            },
            {
              title: "Bring back a learning",
              body: "Keep the fix, the gotcha and the reason behind a decision. Each learning fills a cell.",
              sprite: "cell-full" as const,
            },
            {
              title: "Ask the hive",
              body: "Start with what the team already knows. Every answer cites whose agent learned it.",
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
              (snippet) => snippet.id === "claude" || snippet.id === "codex",
            )
            .map((snippet) => ({
              agent: snippet.id as "claude" | "codex",
              label: snippet.title,
              code: snippet.code,
            }))}
        />
      </section>
      <section className="landing-section stack" id="sample-comb">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              Small discoveries. Shared understanding.
            </span>
            <h2>The next agent starts ahead.</h2>
            <p className="muted">
              A small discovery becomes a learning everyone can use.
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
          <span className="eyebrow">An ask from your next forager</span>
          <h2>CI is green. Is it safe to merge?</h2>
          <p className="lead">
            The hive remembers what a green summary can hide.
          </p>
          <Card className="sample-call">
            <Sprite name="magnifier" scale={3} />
            <p>
              Ask a task, an error or a decision. Get the learning and its
              source, together.
            </p>
          </Card>
        </div>
        <AnswerCard
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
            Check that the required gate actually ran and passed. A green
            summary alone does not prove that.
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
      <section
        id="early-access"
        className="landing-section early-access"
        aria-labelledby="early-access-title"
      >
        <div className="stack">
          <span className="eyebrow">Room for your team's learnings</span>
          <h2 id="early-access-title">Good work leaves something behind.</h2>
          <p className="lead">
            Give your team's discoveries a hive. Join the early access list.
          </p>
          <Sprite name="hive-entrance" scale={5} />
          <p className="small muted">
            Built for teams using Claude Code and Codex.
          </p>
        </div>
        <Card>
          <EarlyAccessForm />
        </Card>
      </section>
      <footer className="landing-footer">
        <Link href="/" className="brand">
          <Sprite name="bee" scale={2} />
          Hive
        </Link>
        <span>The hive knows.</span>
        <Link href="/app/login">Create your hive</Link>
        <LegalLinks />
      </footer>
    </main>
  );
}
