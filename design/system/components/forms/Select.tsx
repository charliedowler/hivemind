"use client";

import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { Sprite } from "../sprites/Sprite";
import { cx } from "../cx";

export type SelectOption = string | { value: string; label: string; disabled?: boolean };

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "multiple"> {
  options?: SelectOption[];
  size?: "sm" | "md" | "lg";
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export function Select({ options = [], size = "md", label, hint, error, id, disabled, required, className, children, "aria-describedby": describedBy, "aria-invalid": invalid, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const note = error || hint;
  const noteId = `${selectId}-note`;
  return (
    <div className="hm-field">
      {label ? <label className="hm-field-label" htmlFor={selectId}>{label}{required ? <span className="hm-field-required" aria-hidden="true"> *</span> : null}</label> : null}
      <span className={cx("hm-select", `hm-control-${size}`, Boolean(error) && "hm-select-invalid", disabled && "hm-control-disabled", className)}>
        <select {...rest} id={selectId} disabled={disabled} required={required} aria-invalid={error ? true : invalid} aria-describedby={cx(describedBy, note ? noteId : undefined) || undefined}>
          {children ?? options.map((option) => typeof option === "string" ? <option key={option} value={option}>{option}</option> : <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
        </select>
        <Sprite name="icon-chevron-down" scale={size === "lg" ? 2 : 1} />
      </span>
      {note ? <span id={noteId} className={cx("hm-field-note", Boolean(error) && "hm-field-error")}>{note}</span> : null}
    </div>
  );
}
