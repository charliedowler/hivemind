"use client";

import { useState } from "react";
import { cx } from "../cx";
import { Sprite } from "../sprites/Sprite";
import type { AgentKind } from "./MemberBee";

export interface InstallOption {
  agent: AgentKind;
  label: string;
  code: string;
}

export interface InstallSnippetProps {
  options: InstallOption[];
  footnote?: string;
  className?: string;
}

export function InstallSnippet({ options, footnote = "One line. Your agent joins the hive.", className }: InstallSnippetProps) {
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const option = options[selected] ?? options[0];
  if (!option) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(option.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
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
            className="hm-install-tab"
            onClick={() => {
              setSelected(index);
              setCopied(false);
            }}
          >
            <span className={`hm-agent-dot hm-agent-dot-${item.agent}`} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="hm-install-body" role="tabpanel">
        <pre className="hm-install-code">
          <code>
            {option.code.split("\n").map((line, index) => (
              <span key={index}>
                <span className="hm-prompt">$ </span>
                {line}
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
        <button type="button" className="hm-install-copy" data-copied={copied} onClick={copy}>
          <Sprite name={copied ? "icon-check" : "icon-copy"} scale={1} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="hm-install-foot">
        <Sprite name={option.agent === "claude" ? "bee-claude" : "bee-codex"} scale={1} />
        {footnote}
      </div>
    </div>
  );
}
