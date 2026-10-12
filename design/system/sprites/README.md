# Hive sprites

Every sprite is a character grid in `art/*.mjs`. One character is one pixel; `.` is transparent; letters map to colours in `art/palette.mjs`. `node sprites/build.mjs` checks every row width, then writes one SVG per sprite, `sprites.json`, `../components/sprites/spriteData.ts` and `../tokens/patterns.css`.

Rules: 1px ink (`K`) silhouette, flat fills, light from the top left (lighter key top left, darker key bottom right), no curves, no anti-aliasing. Render at whole multiples of the grid only. Frames swap with `steps(1)`; movement across the page is a CSS class on the sprite (`hm-bob`, `hm-bob-slow`, `hm-fly-out`, `hm-fly-back`, `hm-drip`) and always uses stepped easing. Set `--sprite-play: paused` (or `<Sprite paused />`) to freeze frames. Under `prefers-reduced-motion` each sprite shows its first frame.

## Bees (16×16, facing right unless named `-left`)
| Sprite | Frames | Timing | Use |
|---|---|---|---|
| `bee` | 1 | static | Logo lockup, static images |
| `bee-hover` | 2 (wings up, wings flat) | 140ms each | Idle hover; pair with `hm-bob` |
| `bee-fly` / `bee-fly-left` | 2 | 70ms each | Flying; pair with `hm-fly-out` / `hm-fly-back`; also the loading glyph |
| `bee-carry` / `bee-carry-left` | 2 | 90ms each | Carrying a nectar droplet home |
| `bee-deposit` | 4 (carry up, drop released, empty up, empty flat) | 280, 280, 280, 280, 140, 140, 140, 140ms | Dropping nectar into a cell |
| `bee-claude` | 2 | 140ms each | A Claude agent: terminal badge with a clay header and chevron |
| `bee-codex` | 2 | 140ms each | A Codex agent: the same badge in teal |
| `bee-face` | 2 (open eyes, blink) | 2600ms, 160ms | Member avatar inside MemberBee |

The two agent bees differ only in the badge colour (`A` in the palette override). Never add a logo.

## Honeycomb cells (16×18, pointy top)
Cells tile with a 16px column step, an 8px offset on odd rows and a 14px row step; the ink edges overlap exactly.
| Sprite | Frames | Meaning |
|---|---|---|
| `cell-empty` | 1 | No learning yet; dithered hollow |
| `cell-filling` | 4 (levels rising, 320ms each) | A learning being written |
| `cell-half` | 1 | Fresh learning |
| `cell-full` | 1 | A stored learning; the default cell |
| `cell-sealed` | 1 | Confirmed by votes; wax cap |
| `cell-outdated` | 1 | Outdated; grey wax with a crack |
| `cell-asked` | 1 | An open ask; teal with a pollen question mark |
| `comb-cluster` | 1, 48×46 | Seven cells in mixed states; section art |
| `comb-hero` | 1, 80×74 | Nineteen cells; the hero comb |

## Comb tiles (16×28, pattern only)
`comb-tile-wax`, `comb-tile-honey`, `comb-tile-hive`, `comb-tile-teal` are single-colour cell outlines that repeat seamlessly. They are exposed as `--comb-tile-*` data URIs; use them at `--comb-tile-size` (64px 112px, 4× scale) with `image-rendering: pixelated`.

## Props
| Sprite | Grid | Stands for |
|---|---|---|
| `droplet` | 8×10 | Nectar: a learning on its way in |
| `flower` | 16×18 | A repo |
| `jar` | 14×15 | An answer |
| `magnifier` | 14×14 | Search and ask |
| `speech-cite` | 20×17 | An answer that cites a cell |
| `thumb` | 12×11 | A vote |
| `hive-entrance` | 24×18 | The hive itself; sign in, join, footer |

## Icons (12×12, `currentColor`)
`icon-check`, `icon-x`, `icon-chevron-down`, `icon-arrow-right`, `icon-plus`, `icon-copy`, `icon-search`, `icon-thumb`, `icon-terminal`, `icon-cell`.

## Adding a sprite
1. Add the grid to the right file in `art/` using only palette keys. Keep the grid as small as the idea allows.
2. For animation, add more frames and a `timeline` of `[frameIndex, milliseconds]` pairs.
3. Run `node sprites/build.mjs`, then `node preview/build.mjs && node preview/shoot.mjs` and look at it in `preview.png`.
