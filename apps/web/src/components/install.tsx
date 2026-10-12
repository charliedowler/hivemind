"use client";

import { useState } from "react";
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
  return (
    <div className="snippet-list">
      {buildInstallSnippets({ baseUrl, apiKey }).map((snippet) => (
        <section className="snippet" key={snippet.id}>
          <div className="row between">
            <h3>{snippet.title}</h3>
            <CopyButton text={snippet.code} label={`Copy ${snippet.title}`} />
          </div>
          <p className="muted">{snippet.description}</p>
          <pre data-language={snippet.language}>
            <code>{snippet.code}</code>
          </pre>
        </section>
      ))}
    </div>
  );
}

export function KeyBox({ apiKey }: { apiKey: string }) {
  return (
    <section className="key-box">
      <h2>Your API key</h2>
      <p>Shown once. Save it now. Treat it like a password.</p>
      <div className="row">
        <code className="breakable">{apiKey}</code>
        <CopyButton text={apiKey} label="Copy key" />
      </div>
    </section>
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
    <div className="narrow stack">
      <div>
        <h1>Connect your agents</h1>
        <p className="muted">One connection. Everything your team learns.</p>
      </div>
      {apiKey ? (
        <KeyBox apiKey={apiKey} />
      ) : (
        <button
          className="primary self-start"
          onClick={createKey}
          disabled={pending}
        >
          {pending ? "Creating key…" : "Create a new key"}
        </button>
      )}
      {error && <ErrorPanel message={error} />}
      <InstallSnippets baseUrl={baseUrl} apiKey={apiKey} />
    </div>
  );
}
