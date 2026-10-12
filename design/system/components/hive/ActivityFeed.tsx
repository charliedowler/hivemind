import { cx } from "../cx";
import { Sprite } from "../sprites/Sprite";
import type { SpriteName } from "../sprites/spriteData";

export type ActivityKind = "learned" | "asked" | "confirmed" | "answered" | "outdated";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  who: string;
  title: string;
  when: string;
  repo?: string;
}

export interface ActivityFeedProps {
  items: ActivityItem[];
  className?: string;
}

const glyph: Record<ActivityKind, SpriteName> = {
  learned: "bee-carry",
  asked: "magnifier",
  confirmed: "thumb",
  answered: "jar",
  outdated: "cell-outdated",
};

const verb: Record<ActivityKind, string> = {
  learned: "brought nectar from",
  asked: "asked the hive",
  confirmed: "confirmed a cell in",
  answered: "got an answer",
  outdated: "marked a cell outdated in",
};

const takesRepo: Record<ActivityKind, boolean> = {
  learned: true,
  asked: false,
  confirmed: true,
  answered: false,
  outdated: true,
};

export function ActivityFeed({ items, className }: ActivityFeedProps) {
  return (
    <ol className={cx("hm-feed", className)}>
      {items.map((item) => (
        <li key={item.id} className="hm-feed-item">
          <span className="hm-feed-glyph">
            <Sprite name={glyph[item.kind]} scale={2} />
          </span>
          <div className="hm-feed-text">
            <span className="hm-feed-who">{item.who}</span> {verb[item.kind]}
            {takesRepo[item.kind] && item.repo ? <> <span className="hm-feed-repo">{item.repo}</span></> : null}
            <div className="hm-feed-title">{item.title}</div>
          </div>
          <time className="hm-feed-time">{item.when}</time>
        </li>
      ))}
    </ol>
  );
}
