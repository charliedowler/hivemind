"use client";

import { useId, useState } from "react";
import { CopyButton } from "./primitives";

const mcpUrl = "https://gohive.dev/api/mcp";
const apps = [
  {
    name: "Claude app",
    steps: [
      "Open Settings → Connectors in Claude desktop or web. Under Customize → Connectors, select Add → Add custom connector.",
      'Name it "Hive" and enter the server URL below.',
      "Select Connect. Sign in with Google or Slack, pick your hive, and select Allow access.",
      "Use the same Claude account on mobile. Your connector appears there too.",
    ],
    caveat:
      "Custom connectors need a Pro, Max, Team or Enterprise plan. A Team or Enterprise admin may need to allow them.",
  },
  {
    name: "ChatGPT",
    steps: [
      "Open Plugins in the main sidebar → Add → Add custom MCP server.",
      'Name it "Hive", enter the server URL below, and choose OAuth authentication.',
      "Check I understand and want to continue. Select Create as a plugin, sign in, and select Allow access.",
      "Enable Hive in a chat through the + menu.",
    ],
    caveat:
      "Available on Plus, Pro, Business, Enterprise and Edu. A workspace admin may need to allow custom connectors.",
  },
  {
    name: "Codex",
    steps: [
      "Run the add command below in your terminal.",
      "Run the login command and complete sign-in in your browser.",
      "Open Codex CLI or the Codex app. The app reads the same config.",
    ],
    caveat: "",
  },
] as const;

export function ChatAppConnect() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const app = apps[selected];
  return (
    <section className="stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Use Hive from a chat app</h2>
      <div className="hm-install">
        <div className="hm-install-bar" role="tablist" aria-label="Chat app">
          {apps.map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="tab"
              className="hm-install-tab"
              id={`${id}-${index}`}
              aria-selected={selected === index}
              aria-controls={`${id}-panel`}
              tabIndex={selected === index ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                  return;
                event.preventDefault();
                const next =
                  (index +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    apps.length) %
                  apps.length;
                setSelected(next);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>("button")
                  [next]?.focus();
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${selected}`}
          className="stack executor-steps"
        >
          <ol>
            {app.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="row between wrap">
            <code className="breakable">{mcpUrl}</code>
            <CopyButton text={mcpUrl} label="Copy server URL" />
          </div>
          {app.name === "Codex" ? (
            <>
              <div className="row between wrap">
                <code className="breakable">
                  codex mcp add hive --url {mcpUrl}
                </code>
                <CopyButton
                  text={`codex mcp add hive --url ${mcpUrl}`}
                  label="Copy add command"
                />
              </div>
              <div className="row between wrap">
                <code>codex mcp login hive</code>
                <CopyButton
                  text="codex mcp login hive"
                  label="Copy login command"
                />
              </div>
            </>
          ) : (
            <p className="small muted">{app.caveat}</p>
          )}
        </div>
      </div>
    </section>
  );
}
