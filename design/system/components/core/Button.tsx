import type { ButtonHTMLAttributes } from "react";
import { Sprite } from "../sprites/Sprite";
import type { SpriteName } from "../sprites/spriteData";
import { cx } from "../cx";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "inverse" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: SpriteName;
  iconRight?: SpriteName;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({ variant = "primary", size = "md", iconLeft, iconRight, loading = false, fullWidth = false, disabled, type = "button", className, children, ...rest }: ButtonProps) {
  const scale = size === "lg" ? 2 : 1;
  return (
    <button {...rest} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx("hm-btn", `hm-btn-${variant}`, `hm-btn-${size}`, fullWidth && "hm-btn-full", className)}>
      {loading ? <Sprite name="bee-fly" scale={1} /> : iconLeft ? <Sprite name={iconLeft} scale={scale} /> : null}
      {children}
      {iconRight && !loading ? <Sprite name={iconRight} scale={scale} /> : null}
    </button>
  );
}
