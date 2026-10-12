import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const sprites = JSON.parse(read("sprites/sprites.json"));

const sprite = (name, scale = 4, extra = "", style = "") => {
  const art = sprites[name];
  if (!art) throw new Error(`unknown sprite ${name}`);
  const cls = ["sprite", "hm-sprite", extra].filter(Boolean).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" width="${art.w * scale}" height="${art.h * scale}" viewBox="0 0 ${art.w} ${art.h}" shape-rendering="crispEdges" aria-hidden="true"${style ? ` style="${style}"` : ""}>${art.body}</svg>`;
};

const expand = (html) =>
  html.replace(/<span\s+data-sprite="([^"]+)"([^>]*)><\/span>/g, (_, name, rest) => {
    const scale = Number(/data-scale="([^"]+)"/.exec(rest)?.[1] ?? 4);
    const extra = /class="([^"]+)"/.exec(rest)?.[1] ?? "";
    const style = /style="([^"]+)"/.exec(rest)?.[1] ?? "";
    return sprite(name, scale, extra, style);
  });

const tokens = read("tokens/colors.css");
const hexes = [...tokens.matchAll(/--([a-z]+(?:-[a-z]+)?(?:-\d+)?):(#[0-9A-Fa-f]{6})/g)].map(([, name, hex]) => ({ name, hex }));
const ramps = [
  ["Honey and comb", /^honey/],
  ["Pollen highlight", /^pollen/],
  ["Hive dark and ink", /^(hive|ink)/],
  ["Wax surfaces", /^(wax|white)/],
  ["Terminal teal", /^teal/],
  ["Clover, clay, sting, petal, wing", /^(clover|clay|sting|petal|wing)/],
];
const swatches = ramps
  .map(([label, test]) => {
    const chips = hexes
      .filter(({ name }) => test.test(name))
      .map(({ name, hex }) => `<div class="pv-swatch"><div class="pv-swatch-chip" style="background:${hex}"></div><div class="pv-swatch-name">${name}</div><div class="pv-swatch-hex">${hex}</div></div>`)
      .join("");
    return `<div class="pv-block"><div class="eyebrow">${label}</div><div class="pv-swatches">${chips}</div></div>`;
  })
  .join("");

const semantic = ["surface-page", "surface-card", "surface-sunken", "surface-comb", "surface-hive", "surface-terminal", "brand", "accent", "highlight", "text-body", "text-muted", "text-brand", "text-accent", "border-focus", "status-fresh", "status-confirmed", "status-outdated", "status-asked", "danger", "success", "agent-claude", "agent-codex"]
  .map((name) => `<div class="pv-sem-item"><span class="pv-sem-chip" style="background:var(--${name})"></span>--${name}</div>`)
  .join("");

const wide = new Set(["comb-cluster", "hive-entrance", "speech-cite"]);
const gallery = Object.entries(sprites)
  .map(([name, art]) => {
    const scale = name === "comb-hero" ? 4 : name.startsWith("icon-") ? 3 : art.w > 30 ? 4 : 4;
    const cls = name === "comb-hero" ? " pv-sprite-tall" : wide.has(name) ? " pv-sprite-wide" : "";
    return `<div class="pv-sprite${cls}">${sprite(name, scale)}<div class="pv-sprite-name">${name}<span class="pv-sprite-meta">${art.w}×${art.h}${art.frames > 1 ? ` · ${art.frames}f` : ""}</span></div></div>`;
  })
  .join("");

const fragment = (name) => (existsSync(join(here, name)) ? expand(readFileSync(join(here, name), "utf8")) : "");

const css = ["tokens/colors.css", "tokens/typography.css", "tokens/spacing.css", "tokens/effects.css", "tokens/patterns.css", "tokens/base.css", "components/core.css", "components/hive.css", "preview/preview.css"]
  .filter((path) => existsSync(join(root, path)))
  .map(read)
  .join("\n");

const spaces = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64]
  .map((size) => `<div class="pv-space-item"><div class="pv-space-bar" style="width:${size}px;height:${size}px"></div>${size}</div>`)
  .join("");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hive design system</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:ital,wght@0,400;0,600;0,700;0,800;1,400&family=Space+Mono:wght@400;700&family=Silkscreen:wght@400;700&display=swap">
<style>
${css}
</style>
</head>
<body>
<main class="pv-page">
${fragment("hero.html")}

<section class="pv-section" id="colour">
  <h2>${sprite("droplet", 4)}Colour</h2>
  <p>Honey and gold carry the comb, hive dark is the ink, wax cream is the page, pollen is the highlight, and a cool teal is saved for terminals, code and anything asked.</p>
  ${swatches}
  <div class="pv-block"><div class="eyebrow">Semantic aliases</div><div class="pv-sem">${semantic}</div></div>
</section>

<section class="pv-section" id="type">
  <h2>${sprite("speech-cite", 3)}Type</h2>
  <div class="pv-type">
    <div class="pv-type-row"><span class="pv-type-label">Display · Lilita One</span><div class="display" style="font-size:var(--text-display)">The hive knows.</div></div>
    <div class="pv-type-row"><span class="pv-type-label">H1 44 · H2 30 · H3 22</span><div><h1 style="font-size:var(--text-h1)">Ask before you get stung</h1><h2 style="font-size:var(--text-h2);margin-top:8px">Every answer cites its cells</h2><h3 style="font-size:var(--text-h3);margin-top:8px">Whose agent learned it, and when</h3></div></div>
    <div class="pv-type-row"><span class="pv-type-label">Eyebrow · Silkscreen 12</span><div class="eyebrow">212 cells · 6 foragers · acme/web</div></div>
    <div class="pv-type-row"><span class="pv-type-label">Body · Nunito 16</span><div style="max-width:44em">Each person adds one MCP server. As they work, their agents bring learnings back to the hive, and ask it when they hit an error or start in a repo the team already knows.</div></div>
    <div class="pv-type-row"><span class="pv-type-label">Lead · Nunito 18 / 700</span><div style="font-size:var(--text-lead);font-weight:700">A shared memory for your team's coding agents.</div></div>
    <div class="pv-type-row"><span class="pv-type-label">Code · Space Mono 14</span><div class="mono" style="font-size:var(--text-mono)">hive_ask("vitest hangs after the last test")</div></div>
    <div class="pv-type-row"><span class="pv-type-label">Count · Lilita tabular</span><div class="count" style="font-size:var(--text-count)">212 <span class="eyebrow" style="font-size:12px">cells filled</span></div></div>
  </div>
</section>

<section class="pv-section" id="foundations">
  <h2>${sprite("cell-sealed", 3)}Outline, shadow, corners, patterns</h2>
  <div class="pv-block"><div class="eyebrow">Ink outline and hard shadow</div><div class="pv-row">
    <div class="pv-box" style="box-shadow:var(--shadow-hard-sm);border-radius:var(--radius-sm)">shadow-hard-sm<br>radius-sm 4</div>
    <div class="pv-box" style="box-shadow:var(--shadow-hard);border-radius:var(--radius-md)">shadow-hard<br>radius-md 6</div>
    <div class="pv-box" style="box-shadow:var(--shadow-hard-lg);border-radius:var(--radius-lg)">shadow-hard-lg<br>radius-lg 8</div>
    <div class="pv-box" style="box-shadow:var(--shadow-hard-honey);border-radius:var(--radius-pill)">shadow-hard-honey<br>radius-pill 10</div>
    <div class="pv-box" style="box-shadow:var(--shadow-focus);border-radius:var(--radius-pill)">shadow-focus</div>
    <div class="pv-box" style="width:84px;box-shadow:var(--shadow-hard-sm);border-radius:var(--radius-round)">round 30%</div>
    <div style="width:96px;height:108px;filter:var(--shadow-cell)"><div style="width:100%;height:100%;background:var(--ink);clip-path:var(--hex);padding:2px;box-sizing:border-box"><div class="pv-box" style="width:100%;height:100%;border:0;background:var(--honey-400);clip-path:var(--hex)">--hex</div></div></div>
  </div></div>
  <div class="pv-block"><div class="eyebrow">Patterns and dithers, never alpha gradients</div><div class="pv-row">
    <div class="pv-pattern" style="background:var(--comb-tile-wax) 0 0/var(--comb-tile-size),var(--wax)"><span>comb-tile-wax</span></div>
    <div class="pv-pattern" style="background:var(--comb-tile-honey) 0 0/var(--comb-tile-size),var(--honey-400)"><span>comb-tile-honey</span></div>
    <div class="pv-pattern" style="background:var(--comb-tile-hive) 0 0/var(--comb-tile-size),var(--hive-900)"><span>comb-tile-hive</span></div>
    <div class="pv-pattern" style="background:var(--comb-tile-teal) 0 0/var(--comb-tile-size),var(--teal-950)"><span>comb-tile-teal</span></div>
    <div class="pv-pattern" style="background:var(--dither-ink),var(--honey-400)"><span>dither-ink</span></div>
    <div class="pv-pattern" style="background:var(--dither-wax),var(--hive-800)"><span>dither-wax</span></div>
    <div class="pv-pattern" style="background:var(--dither-honey),var(--honey-300)"><span>dither-honey</span></div>
    <div class="pv-pattern" style="background:var(--comb-stripes)"><span>comb-stripes</span></div>
    <div class="pv-pattern" style="background:var(--hive-bands)"><span>hive-bands</span></div>
  </div></div>
  <div class="pv-block"><div class="eyebrow">Spacing · 4px base</div><div class="pv-space">${spaces}</div></div>
  <div class="pv-block"><div class="eyebrow">Motion · props step, UI glides</div><div class="pv-row">
    ${sprite("bee-hover", 4, "hm-bob")}<span class="mono" style="font-size:12px">hm-bob · steps(4)</span>
    ${sprite("bee-carry", 4, "hm-bob-slow")}<span class="mono" style="font-size:12px">hm-bob-slow · steps(4)</span>
    ${sprite("cell-filling", 4)}<span class="mono" style="font-size:12px">cell-filling · 4 frames</span>
    ${sprite("bee-deposit", 4)}<span class="mono" style="font-size:12px">bee-deposit · 4 frames</span>
  </div></div>
</section>

<section class="pv-section" id="sprites">
  <h2>${sprite("bee-hover", 3, "hm-bob")}Sprites</h2>
  <p>Every prop sits on a small grid, with an ink silhouette and flat fills. Frames swap with steps(1); nothing tweens.</p>
  <div class="pv-sprites">${gallery}</div>
</section>

${fragment("core.html")}

${fragment("hive.html")}

<section class="pv-section" id="voice">
  <h2>${sprite("jar", 3)}Voice</h2>
  <ul class="pv-voice">
    <li>${sprite("cell-full", 1)}The hive knows.</li>
    <li>${sprite("cell-full", 1)}Learning saved. Tom's Codex filled a cell in acme/web.</li>
    <li>${sprite("cell-asked", 1)}The hive has no cell for that yet. Be the first to bring it back.</li>
    <li>${sprite("cell-outdated", 1)}Marked outdated. It stays in the comb, greyed, so nobody follows it by mistake.</li>
  </ul>
  <div class="pv-foot">${sprite("hive-entrance", 2)}Hive design system · built at the hackathon on 12 Oct 2026</div>
</section>
</main>
</body>
</html>
`;

writeFileSync(join(root, "preview.html"), page);
console.log(`preview.html ${Math.round(page.length / 1024)}kB`);
