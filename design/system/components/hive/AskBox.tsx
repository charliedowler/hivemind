"use client";

import { useId, useState, type FormEvent } from "react";
import { cx } from "../cx";
import { Sprite } from "../sprites/Sprite";

export type AskState = "idle" | "flying" | "returned";

export interface AskBoxProps {
  state?: AskState;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  statusText?: Partial<Record<AskState, string>>;
  onAsk?: (question: string) => void;
  className?: string;
}

const defaultStatus: Record<AskState, string> = {
  idle: "A forager is waiting",
  flying: "Out looking through the comb",
  returned: "Back with a jar",
};

export function AskBox({
  state = "idle",
  defaultValue = "",
  value,
  onChange,
  placeholder = "What does the team already know?",
  label = "Ask the hive",
  statusText,
  onAsk,
  className,
}: AskBoxProps) {
  const [draft, setDraft] = useState(defaultValue);
  const question = value ?? draft;
  const inputId = useId();
  const flying = state === "flying";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed && !flying) onAsk?.(trimmed);
  };

  return (
    <form
      className={cx("hm-ask", className)}
      data-state={state}
      onSubmit={submit}
    >
      <label className="eyebrow hm-ask-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="hm-ask-field">
        <Sprite name="magnifier" scale={2} />
        <input
          id={inputId}
          className="hm-ask-input"
          value={question}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange?.(event.target.value);
          }}
          maxLength={2000}
          required
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          className="hm-btn hm-btn-primary hm-btn-sm"
          disabled={flying || !question.trim()}
        >
          {flying ? "Asking" : "Ask"}
        </button>
      </div>
      <div className="hm-ask-lane" role="status">
        <Sprite
          name={
            state === "returned"
              ? "bee-carry-left"
              : flying
                ? "bee-fly"
                : "bee-hover"
          }
          scale={2}
          className="hm-ask-bee"
        />
        <Sprite name="jar" scale={2} className="hm-ask-jar" />
        <span className="hm-ask-status">
          {statusText?.[state] ?? defaultStatus[state]}
        </span>
        <Sprite name="flower" scale={2} className="hm-ask-flower" />
      </div>
    </form>
  );
}
