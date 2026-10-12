import type { ReactNode } from "react";
import { cx } from "../cx";
import { Sprite } from "../sprites/Sprite";

export interface HiveHeroProps {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function HiveHero({ eyebrow, title, lead, actions, className }: HiveHeroProps) {
  return (
    <section className={cx("hm-hero", className)}>
      <div className="hm-hero-copy">
        {eyebrow && (
          <div className="eyebrow hm-hero-eyebrow">
            <Sprite name="icon-terminal" scale={1} />
            {eyebrow}
          </div>
        )}
        <h1 className="hm-hero-title">{title}</h1>
        {lead && <p className="hm-hero-lead">{lead}</p>}
        {actions && <div className="hm-hero-actions">{actions}</div>}
      </div>
      <div className="hm-hero-scene" aria-hidden="true">
        <Sprite name="comb-hero" scale={5} className="hm-hero-comb" />
        <Sprite name="bee-carry" scale={4} className="hm-hero-prop hm-bob" style={{ left: "-4%", top: "6%" }} />
        <Sprite name="bee-claude" scale={4} className="hm-hero-prop hm-bob-slow" style={{ right: "-2%", top: "14%" }} />
        <Sprite name="bee-codex" scale={4} className="hm-hero-prop hm-bob" style={{ right: "6%", bottom: "6%" }} />
        <Sprite name="bee-fly-left" scale={3} className="hm-hero-prop hm-bob-slow" style={{ left: "2%", bottom: "16%" }} />
        <Sprite name="droplet" scale={3} className="hm-hero-prop" style={{ left: "18%", top: "30%" }} />
      </div>
      <div className="hm-hero-ground" />
    </section>
  );
}
