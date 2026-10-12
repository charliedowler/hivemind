"use client";

import type { InputHTMLAttributes } from "react";
import { cx } from "../cx";

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "size" | "children"> {
  label: string;
  onChange?: (checked: boolean) => void;
}

export function Switch({ label, checked, defaultChecked, onChange, disabled, className, readOnly, ...rest }: SwitchProps) {
  return (
    <label className={cx("hm-switch", disabled && "hm-switch-disabled", className)}>
      <input {...rest} className="hm-toggle-input" type="checkbox" role="switch" checked={checked} defaultChecked={defaultChecked} disabled={disabled} readOnly={readOnly ?? (checked !== undefined && !onChange)} onChange={onChange ? (event) => onChange(event.target.checked) : undefined} />
      <span className="hm-switch-track" aria-hidden="true"><span className="hm-switch-knob" /></span>
      <span>{label}</span>
    </label>
  );
}
