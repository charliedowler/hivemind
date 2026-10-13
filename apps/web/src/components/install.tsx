"use client";

import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { formatHumanDate } from "@hivemind/core";
import { requestJson, errorMessage } from "@/lib/client";
import { Badge, Card, Button, Input, Sprite } from "@hivemind/design-system";
import { buildInstallSnippets } from "@/lib/install";

import { CopyButton, ErrorPanel } from "./primitives";

const skillUrl =
  "https://github.com/charliedowler/hivemind/blob/main/skills/hive/SKILL.md";

function ExecutorSteps() {
  return (
    <div className="executor-steps stack">
      <p>
        Run <code>npx gohive install --client executor</code> to open your
        organisation's setup page. Or add Hive yourself:
      </p>
      <ol>
        <li>
          Sign in to <a href="https://executor.sh">Executor</a> and choose your
          organisation.
        </li>
        <li>
          Open <strong>Add MCP integration</strong>. Set Display Name to{" "}
          <strong>Hive</strong>, Namespace to <code>hive</code>, and Server URL
          to the address above.
        </li>
        <li>
          Choose OAuth browser sign-in under{" "}
          <strong>How does this server authenticate?</strong>. Leave request
          headers empty.
        </li>
        <li>
          Click <strong>Add integration</strong>. Open Hive, add a connection,
          and finish the browser sign-in and Hive consent.
        </li>
        <li>
          Check that Hive tools are listed. Run{" "}
          <code>npx gohive doctor --client executor</code>.
        </li>
      </ol>
      <p className="muted small">
        In the newer dashboard, use Apps to add an MCP server by URL, then
        connect its account on the Accounts tab.{" "}
        <a href="https://executor.sh/docs/connect-an-account">
          Read the Executor account guide
        </a>
        .
      </p>
      <p className="muted small">
        If Hive already exists, open it and check its URL. Keep the existing
        accounts and permissions.
      </p>
    </div>
  );
}

const clientStorageKey = "hive.install.client.v1";
const clientChanged = "hive-install-client-changed";

function readClient() {
  try {
    return localStorage.getItem(clientStorageKey) ?? "claude";
  } catch {
    return "claude";
  }
}

function subscribeClient(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(clientChanged, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(clientChanged, notify);
  };
}

function ClientSnippets({
  snippets,
}: {
  snippets: ReturnType<typeof buildInstallSnippets>;
}) {
  const remembered = useSyncExternalStore(
    subscribeClient,
    readClient,
    () => "claude",
  );
  const [chosen, setChosen] = useState<string>();
  const selected =
    snippets.find((snippet) => snippet.id === (chosen ?? remembered)) ??
    snippets[0];
  const panelId = useId();
  function choose(id: string) {
    setChosen(id);
    try {
      localStorage.setItem(clientStorageKey, id);
    } catch {}
    window.dispatchEvent(new Event(clientChanged));
  }
  return (
    <div className="hm-install">
      <div className="hm-install-bar" role="tablist" aria-label="Agent">
        {snippets.map((snippet, index) => (
          <button
            key={snippet.id}
            type="button"
            role="tab"
            id={`${panelId}-${snippet.id}`}
            aria-selected={selected.id === snippet.id}
            aria-controls={panelId}
            tabIndex={selected.id === snippet.id ? 0 : -1}
            className="hm-install-tab"
            onClick={() => choose(snippet.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                return;
              event.preventDefault();
              const next =
                (index +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  snippets.length) %
                snippets.length;
              choose(snippets[next].id);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
          >
            <span className={`hm-agent-dot hm-agent-dot-${snippet.id}`} />
            {snippet.title}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${panelId}-${selected.id}`}
      >
        <div className="hm-install-body">
          <pre
            className="hm-install-code"
            tabIndex={0}
            aria-label={`${selected.title} connection details`}
          >
            <code>{selected.code}</code>
          </pre>
          <CopyButton
            key={selected.id}
            text={selected.code}
            label={
              selected.id === "executor" ? "Copy server URL" : "Copy command"
            }
          />
        </div>
        {selected.id === "executor" ? <ExecutorSteps /> : null}
        <p className="hm-install-foot">{selected.description}</p>
      </div>
    </div>
  );
}

export type HeadlessKey = {
  id: string;
  label: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function HeadlessKeys({ initial }: { initial: HeadlessKey[] }) {
  const [keys, setKeys] = useState(initial);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function action(task: () => Promise<void>) {
    setError("");
    setPending(true);
    try {
      await task();
      const data = await requestJson<{ keys: HeadlessKey[] }>(
        "/api/app/account",
      );
      setKeys(data.keys);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = String(new FormData(event.currentTarget).get("label"));
    void action(async () => {
      const result = await requestJson<{ apiKey: string }>("/api/app/keys", {
        label,
      });
      setKey(result.apiKey);
    });
  }
  return (
    <details className="install-fallback">
      <summary>Keys for CI and headless setups</summary>
      <div className="stack">
        <p className="muted">
          Use a key when your agent cannot sign in through a browser. Revoke
          keys that no longer need access.
        </p>
        {error ? <ErrorPanel message={error} /> : null}
        {keys.map((item) => (
          <div className="key-row stack" key={item.id}>
            <strong>
              {item.label} · <code>{item.prefix}</code>
            </strong>
            <p className="small">
              Created {formatHumanDate(item.created_at)} · Last used{" "}
              {item.last_used_at ? formatHumanDate(item.last_used_at) : "Never"}
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || Boolean(item.revoked_at)}
              onClick={() =>
                void action(async () => {
                  await requestJson("/api/app/admin", {
                    action: "revoke",
                    id: item.id,
                  });
                })
              }
            >
              {item.revoked_at ? "Revoked" : "Revoke key"}
            </Button>
          </div>
        ))}
        <form className="stack" onSubmit={create}>
          <Input
            name="label"
            label="New key label"
            required
            maxLength={120}
            placeholder="CI agent"
          />
          <Button type="submit" loading={pending}>
            Create a key
          </Button>
        </form>
        {key ? <KeyBox apiKey={key} /> : null}
      </div>
    </details>
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
        <h2>Connect your agent</h2>
        <ClientSnippets snippets={snippets.slice(0, 3)} />
      </section>
      {snippets.slice(3).map((snippet) => (
        <section className="stack" key={snippet.id}>
          <div>
            <h2>{snippet.title}</h2>
            <p className="muted">
              {snippet.id === "headless"
                ? "Create a key above when your agent cannot sign in through a browser."
                : snippet.description}
            </p>
          </div>
          <Card variant="terminal" className="terminal-card">
            <div className="row between wrap">
              <span className="eyebrow">{snippet.language}</span>
              <CopyButton text={snippet.code} label={`Copy ${snippet.title}`} />
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

export function InstallPage({
  baseUrl,
  initialKeys = [],
}: {
  baseUrl: string;
  initialKeys?: HeadlessKey[];
}) {
  return (
    <div className="install-page stack">
      <div className="page-heading">
        <div>
          <h1>Add your agent</h1>
          <p className="muted">
            Connect Claude Code, Codex or Executor to your team's hive.
          </p>
        </div>
        <Sprite name="bee-carry" scale={4} />
      </div>
      <section className="stack" aria-labelledby="installer-heading">
        <div className="stack">
          <h2 id="installer-heading">Connect your agent</h2>
          <p>
            Run this once. Hive connects your installed agents, adds the Hive
            skill, and sets up Claude's session and capture hooks.
          </p>
        </div>
        <Card variant="terminal" className="terminal-card">
          <div className="row between wrap">
            <span className="eyebrow">Node 20 or later</span>
            <CopyButton
              text="npx gohive install"
              label="Copy installer command"
            />
          </div>
          <pre tabIndex={0} aria-label="Hive installer">
            <code>npx gohive install</code>
          </pre>
        </Card>
        <p className="muted">
          The installer opens supported sign-in flows automatically and checks
          each connection. Choose your account and allow access in the browser.
          Claude Code uses <code>/mcp</code> for its agent sign-in. Use{" "}
          <code>--yes</code> or a terminal without interactive input to print
          the sign-in commands. Your existing settings are backed up. Run{" "}
          <code>npx gohive doctor</code> to check the connection.
        </p>
        <p>
          <a href={skillUrl}>Read the Hive skill</a> to see when your agent
          searches, saves and cites team learnings.
        </p>
      </section>
      <HeadlessKeys initial={initialKeys} />
      <details className="install-fallback">
        <summary>Manual setup for Claude Code, Codex or Executor</summary>
        <div className="stack">
          <p>
            Register the connection below, then{" "}
            <a href={skillUrl}>install the Hive skill</a> in{" "}
            <code>~/.claude/skills/hive</code> or{" "}
            <code>~/.agents/skills/hive</code>. The installer also keeps a
            compatibility copy in <code>~/.codex/skills/hive</code>.
          </p>
          <InstallSnippets baseUrl={baseUrl} />
        </div>
      </details>
    </div>
  );
}
