import { type ReactNode } from "react";
import { cx } from "../cx";

export interface CombGridProps {
  columns?: 1 | 2 | 3 | 4;
  children?: ReactNode;
  className?: string;
}

export function CombGrid({ columns = 3, children, className }: CombGridProps) {
  return (
    <div className={cx("hm-comb-stage", className)}>
      <div className={cx("hm-comb", `hm-comb-${columns}`)}>{children}</div>
    </div>
  );
}
