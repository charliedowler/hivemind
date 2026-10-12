"use client";

import { useId, useState } from "react";
import { cx } from "../cx";
import { Sprite } from "../sprites/Sprite";
import type { AgentKind } from "./MemberBee";

export interface InstallOption {
  agent: AgentKind | "executor";
  label: string;
  code: string;
  description?: string;
}

export interface InstallSnippetProps {
  options: InstallOption[];
  footnote?: string;
  className?: string;
}

export function InstallSnippet({
  options,
  footnote = "Run this command in your terminal to connect your agent.",
  className,
}: InstallSnippetProps) {
  const panelId = useId();
  const [copyError, setCopyError] = useState(false);
  const [selected, setSelected] = useState(0);
  const [copiedCode, setCopiedCode] = useState<string>();
  const option = options[selected] ?? options[0];
  const copied = copiedCode === option?.code;
  if (!option) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(option.code);
      setCopyError(false);
      setCopiedCode(option.code);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <div className={cx("hm-install", className)}>
      <div className="hm-install-bar" role="tablist" aria-label="Agent">
        {options.map((item, index) => (
          <button
            key={item.agent}
            type="button"
            role="tab"
            aria-selected={index === selected}
            aria-controls={panelId}
            id={`${panelId}-${index}`}
            tabIndex={index === selected ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft")
                return;
              event.preventDefault();
              const next =
                (index +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  options.length) %
                options.length;
              setSelected(next);
              setCopiedCode(undefined);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
            className="hm-install-tab"
            onClick={() => {
              setSelected(index);
              setCopiedCode(undefined);
            }}
          >
            <span className={`hm-agent-dot hm-agent-dot-${item.agent}`} />
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="hm-install-body"
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${panelId}-${selected}`}
      >
        <pre
          className="hm-install-code"
          tabIndex={0}
          aria-label={`${option.label} connection details`}
        >
          <code>
            {option.agent !== "executor" && <span className="hm-prompt">$ </span>}
            {option.code}
          </code>
        </pre>
        <button
          type="button"
          className="hm-install-copy"
          data-copied={copied}
          onClick={copy}
        >
          <Sprite name={copied ? "icon-check" : "icon-copy"} scale={1} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {copyError ? (
        <p role="alert" className="hm-install-foot">
          Could not copy. Select the command and try again.
        </p>
      ) : null}
      <div className="hm-install-foot" aria-live="polite">
        <Sprite
          name={option.agent === "claude" ? "bee-claude" : option.agent === "codex" ? "bee-codex" : "bee-face"}
          scale={1}
        />
        {copied ? option.agent === "executor" ? "Server URL copied. Add it to your executor organisation." : "Command copied. Run it in your terminal." : option.description ?? footnote}
      </div>
    </div>
  );
}
