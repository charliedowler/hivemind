import type { ReactNode } from "react";
import { Sprite } from "../sprites/Sprite";
import type { SpriteName } from "../sprites/spriteData";
import { Button } from "../core/Button";
import { IconButton } from "../core/IconButton";
import { cx } from "../cx";

export type ToastTone = "success" | "error" | "warning" | "info" | "honey" | "neutral";

export interface ToastProps {
  tone?: ToastTone;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  role?: "status" | "alert";
  className?: string;
}

const glyphs: Record<ToastTone, SpriteName> = {
  success: "icon-check",
  error: "icon-x",
  warning: "cell-empty",
  info: "bee-hover",
  honey: "droplet",
  neutral: "cell-full",
};

export function Toast({ tone = "neutral", title, description, action, onDismiss, role, className }: ToastProps) {
  return (
    <div role={role ?? (tone === "error" ? "alert" : "status")} className={cx("hm-toast", `hm-toast-${tone}`, className)}>
      <span className="hm-toast-icon"><Sprite name={glyphs[tone]} scale={2} /></span>
      <div className="hm-toast-content">
        <div className="hm-toast-title">{title}</div>
        {description ? <div className="hm-toast-description">{description}</div> : null}
      </div>
      {action ? <Button variant="ghost" size="sm" className="hm-toast-action" onClick={action.onClick}>{action.label}</Button> : null}
      {onDismiss ? <IconButton icon="icon-x" label="Dismiss notification" size="sm" onClick={onDismiss} /> : null}
    </div>
  );
}
