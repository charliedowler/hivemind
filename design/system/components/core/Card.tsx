import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export type CardVariant = "default" | "raised" | "sunken" | "comb" | "hive" | "terminal";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "style"> {
  variant?: CardVariant;
  padding?: number;
}

export function Card({ variant = "default", padding = 24, className, children, ...rest }: CardProps) {
  return <div {...rest} className={cx("hm-card", `hm-card-${variant}`, className)} style={padding === 24 ? undefined : { padding }}>{children}</div>;
}
