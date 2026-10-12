import type { ButtonHTMLAttributes } from "react";
import { Sprite } from "../sprites/Sprite";
import type { SpriteName } from "../sprites/spriteData";
import { cx } from "../cx";

export type IconButtonVariant = "ghost" | "secondary" | "primary" | "inverse";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  icon: SpriteName;
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

export function IconButton({ icon, label, variant = "ghost", size = "md", className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button title={label} {...rest} type={type} aria-label={label} className={cx("hm-iconbtn", `hm-iconbtn-${variant}`, `hm-iconbtn-${size}`, className)}>
      <Sprite name={icon} scale={size === "sm" ? 1 : 2} />
    </button>
  );
}
