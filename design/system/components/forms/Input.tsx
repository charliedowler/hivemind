"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Sprite } from "../sprites/Sprite";
import type { SpriteName } from "../sprites/spriteData";
import { cx } from "../cx";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  size?: "sm" | "md" | "lg";
  iconLeft?: SpriteName;
}

export function Input({ label, hint, error, size = "md", iconLeft, id, className, disabled, required, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const note = error || hint;
  const noteId = `${inputId}-note`;
  return (
    <div className="hm-field">
      {label ? <label className="hm-field-label" htmlFor={inputId}>{label}{required ? <span className="hm-field-required" aria-hidden="true"> *</span> : null}</label> : null}
      <span className={cx("hm-input", `hm-control-${size}`, Boolean(error) && "hm-input-invalid", disabled && "hm-control-disabled", className)}>
        {iconLeft ? <Sprite name={iconLeft} scale={size === "lg" ? 2 : 1} /> : null}
        <input {...rest} id={inputId} disabled={disabled} required={required} aria-invalid={error ? true : invalid} aria-describedby={cx(describedBy, note ? noteId : undefined) || undefined} />
      </span>
      {note ? <span id={noteId} className={cx("hm-field-note", Boolean(error) && "hm-field-error")}>{note}</span> : null}
    </div>
  );
}
