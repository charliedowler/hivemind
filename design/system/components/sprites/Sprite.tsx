import type { CSSProperties } from "react";
import { spriteData, type SpriteName } from "./spriteData";

export interface SpriteProps {
  name: SpriteName;
  scale?: number;
  paused?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Sprite({ name, scale = 4, paused = false, title, className, style }: SpriteProps) {
  const art = spriteData[name];
  const playState = paused ? ({ "--sprite-play": "paused" } as CSSProperties) : undefined;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className ? `sprite hm-sprite ${className}` : "sprite hm-sprite"}
      width={art.w * scale}
      height={art.h * scale}
      viewBox={`0 0 ${art.w} ${art.h}`}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-sprite={name}
      style={{ ...playState, ...style }}
      dangerouslySetInnerHTML={{ __html: art.body }}
    />
  );
}
