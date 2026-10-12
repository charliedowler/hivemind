import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { palette } from "./art/palette.mjs";
import { beeSprites } from "./art/bee.mjs";
import { combSprites, combTiles } from "./art/comb.mjs";
import { propSprites } from "./art/props.mjs";
import { iconSprites } from "./art/icons.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sprites = { ...beeSprites, ...combSprites, ...propSprites, ...iconSprites };

const framePaths = (name, sprite, rows) => {
  if (rows.length !== sprite.h) throw new Error(`${name}: expected ${sprite.h} rows, got ${rows.length}`);
  const colours = { ...palette, ...(sprite.palette ?? {}) };
  const runs = new Map();
  rows.forEach((row, y) => {
    if (row.length !== sprite.w) throw new Error(`${name}: row ${y} is ${row.length} wide, expected ${sprite.w}`);
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === key) end += 1;
      if (key !== ".") {
        if (!(key in colours)) throw new Error(`${name}: unknown palette key ${key} in row ${y}`);
        runs.set(key, `${runs.get(key) ?? ""}M${x} ${y}h${end - x}v1h-${end - x}z`);
      }
      x = end;
    }
  });
  return Array.from(runs, ([key, d]) => `<path fill="${colours[key]}" d="${d}"/>`).join("");
};

const body = (name, sprite) => {
  const frames = sprite.frames.map((rows) => framePaths(name, sprite, rows));
  if (frames.length === 1) return frames[0];
  const timeline = sprite.timeline ?? frames.map((_, index) => [index, 200]);
  const total = timeline.reduce((sum, [, ms]) => sum + ms, 0);
  const keyframes = frames.map((_, frame) => {
    let elapsed = 0;
    const stops = timeline.map(([shown, ms]) => {
      const stop = `${Number(((elapsed / total) * 100).toFixed(2))}%{visibility:${shown === frame ? "visible" : "hidden"}}`;
      elapsed += ms;
      return stop;
    });
    return `@keyframes ${name}-k${frame}{${stops.join("")}100%{visibility:${timeline[0][0] === frame ? "visible" : "hidden"}}}`;
  });
  const first = timeline[0][0];
  const rules = frames.map((_, frame) => `.${name}-f${frame}{animation-name:${name}-k${frame}}`);
  const style = `<style>.${name}-f{visibility:hidden;animation:${total}ms steps(1,end) infinite;animation-play-state:var(--sprite-play,running)}${rules.join("")}${keyframes.join("")}@media (prefers-reduced-motion:reduce){.${name}-f{animation:none}.${name}-f${first}{visibility:visible}}</style>`;
  return style + frames.map((paths, frame) => `<g class="${name}-f ${name}-f${frame}">${paths}</g>`).join("");
};

const svg = (sprite, inner, scale = 4) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="sprite" width="${sprite.w * scale}" height="${sprite.h * scale}" viewBox="0 0 ${sprite.w} ${sprite.h}" shape-rendering="crispEdges" style="image-rendering:pixelated">${inner}</svg>`;

const data = {};
for (const [name, sprite] of Object.entries(sprites)) {
  const inner = body(name, sprite);
  data[name] = { w: sprite.w, h: sprite.h, frames: sprite.frames.length, body: inner };
  writeFileSync(join(here, `${name}.svg`), `${svg(sprite, inner)}\n`);
}

const patterns = [];
for (const [name, sprite] of Object.entries(combTiles)) {
  const inner = framePaths(name, sprite, sprite.frames[0]);
  const markup = svg(sprite, inner);
  writeFileSync(join(here, `${name}.svg`), `${markup}\n`);
  patterns.push(`--${name}:url("data:image/svg+xml,${encodeURIComponent(markup)}");`);
}
writeFileSync(
  join(here, "..", "tokens", "patterns.css"),
  `:root{\n${patterns.join("\n")}\n--comb-tile-size:64px 112px;\n}\n`,
);

writeFileSync(join(here, "sprites.json"), `${JSON.stringify(data, null, 1)}\n`);
const target = join(here, "..", "components", "sprites");
mkdirSync(target, { recursive: true });
writeFileSync(
  join(target, "spriteData.ts"),
  `export interface SpriteArt {\n  w: number;\n  h: number;\n  frames: number;\n  body: string;\n}\n\nexport const spriteData = ${JSON.stringify(data, null, 2)} as const satisfies Record<string, SpriteArt>;\n\nexport type SpriteName = keyof typeof spriteData;\n`,
);
console.log(`${Object.keys(data).length} sprites, ${patterns.length} tiles`);
