import Link from "next/link";
import { EarlyAccessForm } from "@/components/early-access";
import { CopyButton } from "@/components/primitives";
import { buildInstallSnippets } from "@/lib/install";

export default function HomePage() {
  const command = buildInstallSnippets({
    baseUrl: "https://<YOUR_HIVE_URL>",
    apiKey: "<YOUR_KEY>",
  })[0]!.code;
  return (
    <main className="landing">
      <header className="landing-header">
        <Link href="/" className="brand">
          <span className="hive-mark" aria-hidden="true" />
          Hivemind
        </Link>
        <Link href="/app" className="text-button">
          Open the dashboard
        </Link>
      </header>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">
            Hivemind<span>.</span>
          </h1>
          <p className="hero-pitch">
            A shared memory for your team&apos;s coding agents
          </p>
          <p className="hero-description">
            One agent figures it out.
            <br />
            The whole team remembers.
          </p>
          <div className="row wrap hero-actions">
            <a href="#early-access" className="primary">
              Get early access
            </a>
            <Link href="/app" className="secondary">
              Open the dashboard
            </Link>
          </div>
        </div>
        <div
          className="memory-visual"
          aria-label="A learning shared between coding agents"
        >
          <div className="memory-agent">
            Claude Code<span>learns</span>
          </div>
          <div className="memory-thread" />
          <div className="memory-core">
            <span className="hive-mark" aria-hidden="true" />
            <strong>One shared memory</strong>
            <span>Gotchas · fixes · decisions</span>
          </div>
          <div className="memory-branches">
            <div>
              Codex<span>remembers</span>
            </div>
            <div>
              Your team<span>asks</span>
            </div>
          </div>
        </div>
      </section>
      <section className="how-section">
        <h2>How it works</h2>
        <ol className="how-steps">
          <li>
            <span>01</span>
            <h3>Add one MCP server.</h3>
            <p>Connect Claude Code or Codex to your team’s hive.</p>
          </li>
          <li>
            <span>02</span>
            <h3>Agents push what they learn.</h3>
            <p>Keep the fix, the gotcha and the reason behind a decision.</p>
          </li>
          <li>
            <span>03</span>
            <h3>Every agent and teammate can ask.</h3>
            <p>Start with what your team already knows.</p>
          </li>
        </ol>
        <div className="terminal">
          <div className="row between">
            <span>One command to connect</span>
            <CopyButton text={command} />
          </div>
          <pre>
            <code>{command}</code>
          </pre>
        </div>
      </section>
      <section className="example-section">
        <div className="section-heading">
          <h2>The next agent starts ahead.</h2>
          <p className="muted">
            A small discovery becomes an answer everyone can use.
          </p>
        </div>
        <div className="example-grid">
          <article
            className="learning-card sample-learning"
            id="sample-learning"
          >
            <div className="row between">
              <span className="kind kind-gotcha">gotcha</span>
              <span className="muted small">Example learning</span>
            </div>
            <h3>A green CI run can hide a skipped gate</h3>
            <div className="learning-meta">
              <span>Sam</span>
              <span>2h ago</span>
              <span className="repo">team/web</span>
            </div>
            <p>
              The summary check can pass when a required gate job is skipped.
              Check the gate’s conclusion before you merge.
            </p>
            <div className="sample-code">
              gate.result === &quot;success&quot;
            </div>
            <p className="muted">
              Make the summary fail when the gate is skipped, cancelled or
              unsuccessful.
            </p>
            <div className="tags">
              <span>#ci</span>
              <span>#release-safety</span>
              <span>#github-actions</span>
            </div>
            <footer className="card-footer">
              <span>↑ Useful 8</span>
              <code className="small muted">lrn_ci7gate</code>
            </footer>
          </article>
          <article className="sample-answer">
            <div className="row">
              <span className="hive-mark" aria-hidden="true" />
              <h3>Ask the hive</h3>
            </div>
            <p className="sample-question">
              “CI is green. Is it safe to merge?”
            </p>
            <p>
              Check that the required gate actually ran and passed. A green
              summary alone does not prove that.
            </p>
            <a href="#sample-learning" className="citation">
              lrn_ci7gate
            </a>
            <p className="muted">
              If the gate was skipped, inspect its conditions and rerun it
              before merging.
            </p>
            <div className="confidence confidence-high">
              High confidence · 1 source
            </div>
          </article>
        </div>
      </section>
      <section
        id="early-access"
        className="early-access"
        aria-labelledby="early-access-title"
      >
        <div>
          <h2 id="early-access-title">
            Good work leaves
            <br />
            something behind.
          </h2>
          <p className="muted">
            Give your team’s discoveries a home.
            <br />
            Join the early access list.
          </p>
          <p className="small muted">
            Built for teams using Claude Code and Codex.
          </p>
        </div>
        <EarlyAccessForm />
      </section>
      <footer className="landing-footer">
        <Link href="/" className="brand">
          <span className="hive-mark" aria-hidden="true" />
          Hivemind
        </Link>
        <span>Learn once. Remember together.</span>
        <Link href="/app/login">Create your hive</Link>
      </footer>
    </main>
  );
}
