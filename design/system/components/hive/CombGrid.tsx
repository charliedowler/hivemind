import { Children, type ReactNode } from "react";
import { cx } from "../cx";

export interface CombGridProps {
  columns?: number;
  children?: ReactNode;
  className?: string;
}

export function CombGrid({ columns = 3, children, className }: CombGridProps) {
  const cells = Children.toArray(children);
  const rows: ReactNode[][] = [];
  for (let index = 0; index < cells.length; index += columns) rows.push(cells.slice(index, index + columns));

  return (
    <div className={cx("hm-comb", className)}>
      {rows.map((row, index) => (
        <div key={index} className={cx("hm-comb-row", index % 2 === 1 && "hm-comb-row-offset")}>
          {row}
        </div>
      ))}
    </div>
  );
}
