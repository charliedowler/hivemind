"use client";

import type { KeyboardEvent } from "react";
import { cx } from "../cx";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
}

export function Tabs({ tabs, value, onChange, label = "Hive views", className }: TabsProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    const tab = tabs[next];
    if (!tab) return;
    event.preventDefault();
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    onChange(tab.id);
  }
  const selectedIndex = tabs.findIndex((tab) => tab.id === value);
  return (
    <div role="tablist" aria-label={label} className={cx("hm-tabs", className)}>
      {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === value} tabIndex={index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1} className={cx("hm-tab", tab.id === value && "hm-tab-active")} onClick={() => onChange(tab.id)} onKeyDown={(event) => handleKeyDown(event, index)}>{tab.label}{tab.count != null ? <span className="hm-tab-count">{tab.count}</span> : null}</button>)}
    </div>
  );
}
