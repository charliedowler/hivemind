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
      {snippets.map((snippet) =>
        snippet.id === "claude" || snippet.id === "codex" ? (
          <section className="stack" key={snippet.id}>
            <div>
              <h2>{snippet.title}</h2>
              <p className="muted">{snippet.description}</p>
            </div>
            <InstallSnippet
              options={[
                { agent: snippet.id, label: snippet.title, code: snippet.code },
              ]}
            />
          </section>
        ) : (
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
        ),
      )}
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
        Save it now. Treat it like a password. The hive cannot show it again.
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
          <span className="eyebrow">Bring a forager</span>
          <h1>Add your agent</h1>
          <p className="muted">One connection. What your agent learns, the whole hive knows.</p>
        </div>
        <Sprite name="bee-carry" scale={4} />
      </div>
      <p className="muted">Sign in in your browser and allow access to this hive. No pasted key is needed.</p>
      <InstallSnippets baseUrl={baseUrl} />
      <Link href="/app/account" className="text-button">Manage headless keys on your account</Link>
    </div>
  );
}
