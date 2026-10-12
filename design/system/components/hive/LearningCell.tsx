import type { ReactNode } from "react";
import { cx } from "../cx";
import { Sprite } from "../sprites/Sprite";
import type { SpriteName } from "../sprites/spriteData";

export type LearningStatus = "fresh" | "confirmed" | "outdated" | "asked";

export interface LearningCellProps {
  title: string;
  repo: string;
  learnedBy: string;
  when: string;
  votes?: number;
  status?: LearningStatus;
  filling?: boolean;
  href?: string;
  footer?: ReactNode;
  className?: string;
}

const statusSprite: Record<LearningStatus, SpriteName> = {
  fresh: "cell-half",
  confirmed: "cell-sealed",
  outdated: "cell-outdated",
  asked: "cell-asked",
};

const statusLabel: Record<LearningStatus, string> = {
  fresh: "Fresh",
  confirmed: "Confirmed",
  outdated: "Outdated",
  asked: "Asked",
};

export function LearningCell({
  title,
  repo,
  learnedBy,
  when,
  votes = 0,
  status = "fresh",
  filling = false,
  href,
  footer,
  className,
}: LearningCellProps) {
  const body = (
    <div className="hm-cell-edge">
      <div className="hm-cell-wall">
        <div className="hm-cell-face">
          <div className="hm-cell-status">
            <Sprite name={filling ? "cell-filling" : statusSprite[status]} scale={2} />
            {statusLabel[status]}
          </div>
          <div className="hm-cell-main">
            <h3 className="hm-cell-title">{title}</h3>
            <span className="hm-cell-repo">{repo}</span>
          </div>
          <div className="hm-cell-meta">
            {learnedBy}
            <time>{when}</time>
          </div>
          <div className="hm-cell-votes">
            {footer ?? (
              <>
                <Sprite name="thumb" scale={1} title="Votes" />
                {votes}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  const classes = cx("hm-cell", `hm-cell-${status}`, className);

  return href ? (
    <a className={classes} href={href}>
      {body}
    </a>
  ) : (
    <article className={classes}>{body}</article>
  );
}

export interface EmptyCellProps {
  label?: string;
  className?: string;
}

export function EmptyCell({ label = "Room for one more", className }: EmptyCellProps) {
  return (
    <div className={cx("hm-cell", "hm-cell-empty", className)}>
      <div className="hm-cell-edge">
        <div className="hm-cell-wall">
          <div className="hm-cell-face">
            <Sprite name="bee-hover" scale={3} className="hm-bob" />
            <div className="hm-cell-status">{label}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
