"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  InstallSnippet,
  Sprite,
} from "@hivemind/design-system";
import { buildInstallSnippets } from "@/lib/install";
import { requestJson, errorMessage } from "@/lib/client";
import { CopyButton, ErrorPanel } from "./primitives";

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
  const [apiKey, setApiKey] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function createKey() {
    setPending(true);
    setError("");
    try {
      const result = await requestJson<{ apiKey: string }>("/api/app/keys", {});
      setApiKey(result.apiKey);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="install-page stack">
      <div className="page-heading">
        <div>
          <h1>Add your agent</h1>
          <p className="muted">
            Connect Claude Code or Codex to your team's hive with the commands
            below.
          </p>
        </div>
        <Sprite name="bee-carry" scale={4} />
      </div>
      {apiKey ? (
        <KeyBox apiKey={apiKey} />
      ) : (
        <Card className="row between wrap">
          <div>
            <h2>Create an API key</h2>
            <p className="muted">Create a key to fill the commands below.</p>
          </div>
          <Button onClick={createKey} loading={pending} iconLeft="icon-plus">
            {pending ? "Creating a key" : "Create a new key"}
          </Button>
        </Card>
      )}
      {error ? <ErrorPanel message={error} /> : null}
      <InstallSnippets baseUrl={baseUrl} apiKey={apiKey} />
    </div>
  );
}
