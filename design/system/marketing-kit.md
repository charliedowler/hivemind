# Hivemind marketing kit

Exact instructions for producing social images in the Hivemind design system. Build each image as a self-contained HTML page that imports `design/system/styles.css`, `components/core.css` and `components/hive.css`, inline the sprites from `sprites/*.svg`, and screenshot it with Playwright at device scale factor 2. Never redraw a sprite by hand and never scale one by a fraction.

## Canvases
| Use | Size | Safe margin |
|---|---|---|
| Open Graph, X, LinkedIn link card | 1200×630 | 64px |
| Square post | 1080×1080 | 72px |
| Story, vertical | 1080×1920 | 96px sides, 220px top and bottom |
| Launch header, wide | 1600×900 | 80px |

## Canvas backgrounds
Pick one per image. Every canvas gets a 4px ink frame inset 16px from the edge with a 12px chamfer (`border: 4px solid var(--ink); border-radius: 12px` under `corner-shape: bevel`).
1. **Honey comb** (default, launch and hero images): `background: var(--comb-tile-honey) 0 0 / 96px 168px, var(--honey-400)` with `image-rendering: pixelated`. Ink text.
2. **Wax** (quotes, steps, anything text heavy): `background: var(--comb-tile-wax) 0 0 / 96px 168px, var(--wax)`. Ink text.
3. **Hive dark** (night variant, for contrast in a feed): `background: var(--comb-tile-hive) 0 0 / 96px 168px, var(--hive-900)`. Wax text, honey accents, sprites get a 4px `--honey-600` drop shadow instead of ink.
4. **Terminal** (developer-facing): `background: var(--terminal-scan), var(--teal-950)`. `--teal-100` text, `--pollen-500` prompt.
Finish every canvas with a 24px ground strip along the bottom inside the frame: `background: var(--dither-ink), var(--honey-600); border-top: 4px solid var(--ink)`. On hive dark use `--hive-700` under the dither.

## Sprite scale
Use whole multiples only. Hero bee: 12× (192px). Supporting bees: 6× or 8×. Comb (`comb-hero`): 6× on 1200×630, 8× on square, 10× on story. Cells used as bullets: 4×. Icons inside pills: 2×. Every sprite on a light canvas gets `filter: drop-shadow(6px 6px 0 var(--ink))`; never a blurred shadow.

## Which sprites carry which message
### 1. A network of bees feeding the comb ("what one agent learns, the whole hive knows")
- Canvas: honey comb, 1200×630 or 1600×900.
- Centre right: `comb-hero` at 6×. Around it, five bees on a loose ring, all facing the comb: two `bee-carry` on the left, one `bee-carry-left` on the right, one `bee-claude`, one `bee-codex`. Vary height by at least 40px so no two share a row.
- From each carrying bee to the comb, a dotted flight path: 8px ink squares every 24px on a straight line or a single 45° stair. No curves, no arrows.
- One `flower` at 6× in each bottom corner standing on the ground strip, each with a repo pill above it.
- Left third: eyebrow pill, headline in Lilita One (max 3 lines), one line of lead.
- Do not draw one bee larger than the rest, and do not put any bee at the centre of the comb. It is a flat team.

### 2. A ladder of four steps (how it works)
- Canvas: wax, 1080×1080 or 1200×630.
- Four rungs stacked bottom to top (square) or left to right (wide), joined by a 4px ink rail with a 45° stair between rungs. Each rung is a white card: 4px ink border, 8px chamfer, `8px 8px 0 var(--ink)` shadow.
- Rung sprites and copy, in order:
  1. `icon-terminal` in an agent-coloured tile + `bee-hover` — "Add one MCP server"
  2. `flower` + `bee-carry` — "Your agent brings back what it learns"
  3. `cell-filling` then `cell-sealed` — "The hive keeps it, with a name on it"
  4. `magnifier` + `jar` — "The next agent asks before it gets stung"
- Each rung has a number stamp (see stamps) at its left edge. One `bee-fly` at 8× climbs beside the top rung.

### 3. A quote card
- Canvas: wax or hive dark, 1080×1080.
- `speech-cite` at 10× top left as the quote mark. Do not use typographic quotation marks at display size.
- Quote in Lilita One, 64–80px, max 5 lines, sentence case, no exclamation mark.
- Attribution row at the bottom: `bee-face` at 6× in an octagon tile (the MemberBee recipe: 2px→4px ink border, `--radius-round`, agent-soft background), name in Nunito 800 32px, role in Silkscreen 20px.
- One `cell-full` at 4× before a small "The hive knows." in Silkscreen 20px, bottom right.

### 4. A terminal hero with a bee
- Canvas: terminal, 1200×630.
- A terminal window fills the left two thirds: `--teal-950` face, 4px ink border, 8px chamfer, `8px 8px 0 var(--teal-700)` shadow, a 40px title bar in `--teal-900` with three 12px ink-outlined squares (clay, pollen, clover) instead of round traffic lights.
- Inside, Space Mono 28px, line height 1.6: a `$` prompt in `--pollen-500`, the real install command from InstallSnippet, then two lines of tool output such as `hive_ask("vitest hangs after the last test")` and `1 cell cited · Tom's Codex · acme/web`. A solid `--pollen-500` block cursor ends the last line.
- Right third: `bee-claude` or `bee-codex` at 12× hovering, with a `droplet` at 6× below it and `cell-full` at 8× under that. Headline in Lilita One in `--wax` under or above the bee.

### 5. A split poster shared with Wolf
- Canvas: 1600×900 or 1080×1080, split by a hard diagonal: a 45° stair of 16px steps in ink, 8px thick, from top centre-right to bottom centre-left. No soft blend between the halves.
- Left half is Hivemind: honey comb background, `comb-cluster` at 8×, two bees, wordmark "Hivemind" in Lilita One with the `bee` at 6×.
- Right half is Wolf: use the Wolf system's own tokens and sprites from its `design/system` (tuxedo dark background, its wolf sprite, its wordmark). Do not recolour Wolf sprites with Hivemind colours or the reverse.
- Shared elements prove the same hand: the same 4px ink frame around the whole canvas, the same Silkscreen eyebrow pill centred on the seam ("Built at the hackathon"), the same hard shadow offset on both sides, both mascots at the same pixel scale and on the same ground line.
- Each half keeps its own headline. Equal area, equal weight. One `bee-carry` may cross the seam towards the wolf carrying a droplet; that is the only element allowed to overlap.

## Pill recipes
All pills: Silkscreen, uppercase, letter-spacing .04em, `-webkit-font-smoothing: none`, 4px ink border, 10px chamfer, no blur.
| Pill | Fill | Text | Height / type | Shadow |
|---|---|---|---|---|
| Eyebrow | `--ink` | `--pollen-500` | 44px / 20px | none |
| Status fresh | `--pollen-500` | `--ink` | 44px / 20px | `4px 4px 0 var(--ink)` |
| Status confirmed | `--clover-700` | white | 44px / 20px | `4px 4px 0 var(--ink)` |
| Status asked | `--teal-600` | white | 44px / 20px | `4px 4px 0 var(--ink)` |
| Status outdated | `--wax-200` | `--wax-700` | 44px / 20px | none |
| Repo | `--ink` | `--wax`, Space Mono 20px, not uppercase | 40px | none |
| Agent | `--clay-500` (Claude) or `--teal-500` (Codex) | `--ink` | 44px / 20px, `icon-terminal` at 2× first | `4px 4px 0 var(--ink)` |
| Call to action | `--honey-500` | `--ink`, Lilita One 28px, sentence case | 64px | `6px 6px 0 var(--ink)` |
Leave 16px inside padding at the sides, 12px between an icon and its label, and never put two shadowed pills closer than 16px.

## Stamp recipes
Stamps are the loud, tilted marks. One per image at most.
- **Number stamp** (ladder steps): 72px octagon (`--radius-round`), `--honey-400` fill, 4px ink border, `4px 4px 0 var(--ink)`, numeral in Lilita One 40px. No tilt.
- **"The hive knows." stamp**: pointy-top hexagon 220×250 built like a LearningCell (ink 4px, wall `--honey-600` 12px, face `--pollen-200`), text in Lilita One 34px on three lines, `filter: drop-shadow(6px 6px 0 var(--ink))`, rotated −6°. Rotation is allowed on stamps only.
- **Cited stamp**: rectangle 260×84, 4px `--clover-700` border, 6px chamfer, no fill, "Cited" in Silkscreen 40px `--clover-700`, a `cell-sealed` at 4× to its left, rotated 4°. Overlay `--dither-wax` at full size so it reads as inked.
- **Outdated stamp**: the same rectangle in `--wax-500` with "Outdated", rotated −4°, over a greyed cell. Never use sting red for outdated; red means an error.

## Minimum text sizes (at 1× canvas pixels)
| Text | 1200×630 | 1080×1080 | 1080×1920 |
|---|---|---|---|
| Headline, Lilita One | 64px (max 96) | 80px (max 120) | 96px (max 140) |
| Lead, Nunito 700 | 28px | 32px | 36px |
| Body, Nunito 600 | 24px | 28px | 32px |
| Eyebrow and pills, Silkscreen | 20px | 22px | 24px |
| Code, Space Mono | 24px | 26px | 28px |
| Attribution and footnote | 20px | 22px | 24px |
Silkscreen must sit on a multiple of its 8px design grid to stay crisp: use 16, 24, 32 or 40px when the size is flexible, and never below 20px on a social canvas. Headlines stay in sentence case, max 3 lines on wide canvases and 5 on square. Contrast: ink on honey, wax or pollen; wax on hive dark or teal; never honey text on wax.

## Copy rules for images
Sentence case. No exclamation marks. No emoji. Use the vocabulary: hive, cell, learning, forager, nectar, ask, cite. Name agents as "Priya's Claude" and "Sam's Codex"; never show a vendor logo. No queen, no ranks. Sign off with "The hive knows." at most once per image.

## Checklist before export
- Every sprite is at a whole multiple and is crisp at 100% zoom.
- Every shape has an ink outline and a hard, unblurred shadow in one direction (down and right).
- No curve anywhere: corners are chamfers, circles are octagons, paths are stairs.
- No gradient used for shading; dither or flat steps only.
- Text meets the minimum sizes and sits inside the safe margin.
- Export PNG at 2× and check the 1× downscale still reads on a phone.
