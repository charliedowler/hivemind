import type { ReactNode } from "react";
import { cx } from "../cx";

export interface TooltipProps {
  label: string;
  children: ReactNode;
  placement?: "top" | "bottom";
  alwaysOpen?: boolean;
}

export function Tooltip({ label, children, placement = "top", alwaysOpen = false }: TooltipProps) {
  return (
    <span className="hm-tooltip">
      {children}
      <span role="tooltip" data-always-open={alwaysOpen || undefined} className={cx("hm-tooltip-label", `hm-tooltip-${placement}`)}>{label}</span>
    </span>
  );
}
