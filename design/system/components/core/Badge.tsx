import type { HTMLAttributes } from "react";
import { Sprite } from "../sprites/Sprite";
import type { SpriteName } from "../sprites/spriteData";
import { cx } from "../cx";

export type BadgeTone = "fresh" | "confirmed" | "outdated" | "asked" | "claude" | "codex" | "neutral" | "inverse";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: SpriteName;
}

export function Badge({ tone = "neutral", icon, className, children, ...rest }: BadgeProps) {
  return <span {...rest} className={cx("hm-badge", `hm-badge-${tone}`, className)}>{icon ? <Sprite name={icon} scale={1} /> : null}{children}</span>;
}
