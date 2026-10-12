"use client";

import Link from "next/link";
import {
  Badge,
  Card,
  InstallSnippet,
  Sprite,
} from "@hivemind/design-system";
import { buildInstallSnippets } from "@/lib/install";

import { CopyButton } from "./primitives";

const skillUrl = "https://github.com/charliedowler/hivemind/blob/main/skills/hive/SKILL.md";

function ExecutorSteps() {
  return (
    <div className="executor-steps stack">
      <p>Run <code>npx gohive install --client executor</code> to open your organisation's setup page. Or add Hive yourself:</p>
      <ol>
        <li>Sign in to <a href="https://executor.sh">Executor</a> and choose your organisation.</li>
        <li>Open <strong>Add MCP integration</strong>. Set Display Name to <strong>Hive</strong>, Namespace to <code>hive</code>, and Server URL to the address above.</li>
        <li>Choose OAuth browser sign-in under <strong>How does this server authenticate?</strong>. Leave request headers empty.</li>
        <li>Click <strong>Add integration</strong>. Open Hive, add a connection, and finish the browser sign-in and Hive consent.</li>
        <li>Check that Hive tools are listed. Run <code>npx gohive doctor --client executor</code>.</li>
      </ol>
      <p className="muted small">In the newer dashboard, use Apps to add an MCP server by URL, then connect its account on the Accounts tab. <a href="https://executor.sh/docs/connect-an-account">Read the Executor account guide</a>.</p>
      <p className="muted small">If Hive already exists, open it and check its URL. Keep the existing accounts and permissions.</p>
    </div>
  );
}

export function InstallSnippets({
  baseUrl,
  apiKey = "<YOUR_KEY>",
}: {
  baseUrl: string;
  apiKey?: string;
}) {
  const snippets = buildInstallSnippets({ baseUrl, apiKey });
  return (
    <div className="snippet-list">
      <section className="stack">
        <h2>Connect your forager</h2>
        <InstallSnippet options={snippets.slice(0, 3).map((snippet) => ({
          agent: snippet.id as "claude" | "codex" | "executor",
          label: snippet.title,
          code: snippet.code,
          description: snippet.description,
          details: snippet.id === "executor" ? <ExecutorSteps /> : undefined,
        }))} />
      </section>
      {snippets.slice(3).map((snippet) => (
          <section className="stack" key={snippet.id}>
            <div>
              <h2>{snippet.title}</h2>
              <p className="muted">{snippet.description}</p>
            </div>
            <Card variant="terminal" className="terminal-card">
              <div className="row between wrap">
                <span className="eyebrow">{snippet.language}</span>
                <CopyButton
                  text={snippet.code}
                  label={`Copy ${snippet.title}`}
                />
              </div>
              <pre
                data-language={snippet.language}
                tabIndex={0}
                aria-label={snippet.title}
              >
                <code>{snippet.code}</code>
              </pre>
            </Card>
          </section>
        ))}
    </div>
  );
}

export function KeyBox({ apiKey }: { apiKey: string }) {
  return (
    <Card className="key-box">
      <div className="row wrap">
        <Sprite name="cell-sealed" scale={2} />
        <Badge tone="fresh">Shown once</Badge>
      </div>
      <h2>Your API key</h2>
      <p>
        Save your key now and keep it private. The hive cannot show it again.
      </p>
      <div className="row wrap">
        <code className="breakable">{apiKey}</code>
        <CopyButton text={apiKey} label="Copy key" />
      </div>
    </Card>
  );
}

export function InstallPage({ baseUrl }: { baseUrl: string }) {
  return (
    <div className="install-page stack">
      <div className="page-heading">
        <div>
          <h1>Add your agent</h1>
          <p className="muted">Connect Claude Code, Codex or Executor to your team's hive.</p>
        </div>
        <Sprite name="bee-carry" scale={4} />
      </div>
      <section className="stack" aria-labelledby="installer-heading">
        <div className="stack">
          <h2 id="installer-heading">Send in your forager</h2>
          <p>Run this once. Hive connects your installed agents, adds the Hive skill, and sets up Claude's session and capture hooks.</p>
        </div>
        <Card variant="terminal" className="terminal-card">
          <div className="row between wrap">
            <span className="eyebrow">Node 20 or later</span>
            <CopyButton text="npx gohive install" label="Copy installer command" />
          </div>
          <pre tabIndex={0} aria-label="Hive installer"><code>npx gohive install</code></pre>
        </Card>
        <p className="muted">Sign in through your browser and allow access to your hive. Your existing settings are backed up. Run <code>npx gohive doctor</code> to check the connection.</p>
        <p><a href={skillUrl}>Read the Hive skill</a> to see when your agent searches, saves and cites team learnings.</p>
      </section>
      <details className="install-fallback">
        <summary>Manual setup for Claude Code, Codex or Executor</summary>
        <div className="stack">
          <p>Register the connection below, then <a href={skillUrl}>install the Hive skill</a> in <code>~/.claude/skills/hive</code> or <code>~/.agents/skills/hive</code>. The installer also keeps a compatibility copy in <code>~/.codex/skills/hive</code>.</p>
          <InstallSnippets baseUrl={baseUrl} />
        </div>
      </details>
      <Link href="/app/account" className="text-button">Manage headless keys on your account</Link>
    </div>
  );
}
