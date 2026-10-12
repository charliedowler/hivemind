# Hive — Design System

Design system for **Hive**: a shared memory for a team's coding agents. Each person adds one MCP server to Claude Code or Codex. As they work, their agents push learnings (gotchas, fixes, decisions) to the hive, and agents ask the hive when they hit an error or start work in a repo the team already knows. People can ask the hive in a web dashboard, and every answer cites whose agent learned it.

The whole brand is **8-bit pixel art** with a **beehive narrative**. Agents are worker bees. A learning is a honeycomb cell filled with honey. The hive is the shared comb. Foragers fly out to repos (flowers) and bring nectar back. An answer is the hive handing a jar to the bee that asked. Warm, busy, cooperative. There is no queen: it is a flat team, and nothing in the system ranks one bee above another.

## Sources
- Construction rules come from the World Cup Sweepstakes 2026 design system (`Hireaway/world-cup-sweepstakes`, `design/system/`): ink outlines, hard offset shadows, chamfered corners, dither instead of alpha, sprites on small grids, stepped motion for props. Hive keeps those rules and changes the theme.
- A sibling system, Wolf, is built from the same reference. The two share the outline, shadow, corner and pixel font rules and the sprite pipeline (`sprites/build.mjs` reading character grids from `sprites/art/`), so they read as the same hand. Hive owns honey, comb and bees.
- Product language comes from `docs/SPEC.md` and the app in `apps/web`. No logo, Figma or photography was supplied. **No logo exists**; the brand name is set in Lilita One beside the `bee` sprite.

## Products / surfaces
1. **Landing page** (desktop 1200, mobile 390): HiveHero, the install snippet, a comb of sample learnings.
2. **Dashboard**: the comb (CombGrid of LearningCells), AskBox and AnswerCard, ActivityFeed, members as MemberBees, install and key management.
3. **Agent surface** (terminal, not styled by this system): the tool results agents read. The dashboard quotes them inside `terminal` cards and InstallSnippet.

## CONTENT FUNDAMENTALS
- **Vocabulary is law.** Use these words, and only these, for these things:
  - **hive**: the team's shared memory. "Ask the hive", "Join a hive".
  - **cell**: one stored learning as an object in the comb. "Cited cells", "212 cells".
  - **learning**: the content of a cell. "Learning saved."
  - **forager**: an agent out working in a repo. "A forager is out looking."
  - **nectar**: a learning on its way in, not yet stored. "Tom's Codex brought nectar from acme/web."
  - **ask**: the verb and the noun for a question. "Ask the hive", "an open ask".
  - **cite**: what an answer does to cells. "Every answer cites its cells."
  - Supporting words: comb (all the cells together), jar (an answer), flower (a repo), fresh, confirmed, outdated, asked.
- **Never:** queen, drone, swarm, colony leader, or any rank between bees. Never "knowledge base", "wiki", "docs", "note", "post", "user" (say member or the person's name), "AI" as a noun for an agent (say agent, or "Priya's Claude").
- **Voice:** warm, plain, slightly playful. A helpful teammate, not a mascot. The signature line is **"The hive knows."** Use bee language where it carries meaning and stop there: one image per sentence, no puns ("un-bee-lievable" is out).
- **No exclamation marks in UI. No emoji anywhere.** Sentence case everywhere, including headlines and buttons ("Ask the hive", "Add your agent"). All caps only in Silkscreen eyebrows.
- **Attribution is part of the tone.** Name whose agent learned it, possessive first: "Priya's Claude", "Sam's Codex". An answer with no citation is not an answer.
- **Honest about gaps:** "The hive has no cell for that yet. Be the first to bring it back." Empty and disabled states explain the rule, not the UI: "Outdated cells stay in the comb, greyed, so nobody follows them by mistake."
- **Numbers and code:** counts as plain numerals ("212 cells"). Relative time in feeds ("2m", "3 days ago"). Repos as `owner/name` in Space Mono. Commands and tool calls always in Space Mono, never in quotes.
- **Examples:** "Learning saved. The hive knows." · "Back with a jar. 2 cells cited." · "Out looking through 212 cells" · "One line. Your agent joins the hive." · "What one agent learns, the whole hive knows."

## VISUAL FOUNDATIONS
**The vibe:** a working hive on a 16-bit console. Everything is chunky, outlined in ink, cut with chamfered pixel corners, and casts a hard offset shadow like a sprite on a tile map. No curves: `corner-shape:bevel` is set on everything in `tokens/base.css`, so every radius is a 45° cut and `--radius-round` (30%) turns a circle into an octagon. Hive furniture is used literally: cells carry status, a bee flies off when you ask, a jar comes back as the answer, flowers stand for repos.
- **Colour:** honey amber (`--honey-500` #F2A51E primary, `--honey-400` #FFBE3D for comb fields, `--honey-600` #D98A12 for cell walls). Pollen yellow `--pollen-500` #FFE03A is the highlight and the "fresh" status. Hive dark `--ink` #1F1408 is a brown-black used for every outline and shadow; `--hive-900/800` are the dark surfaces. Wax cream `--wax` #FDF6E3 is the page. The cool contrast is terminal teal (`--teal-950` #06262B for code surfaces, `--teal-700` #187078 for the accent action and links) and it is also the "asked" status. Clover green `--clover-700` confirms, sting red `--sting-600` is danger only. Agents are told apart by badge colour, never by logos: Claude is clay `--clay-500` #E8744A, Codex is teal `--teal-500` #3BB3B8. Semantic aliases live in `tokens/colors.css`.
- **Status:** fresh (pollen, a half-filled cell), confirmed by votes (clover text on a wax-capped cell), outdated (grey wax, struck title, cracked cell), asked (teal cell with a pollen question mark).
- **Type:** Lilita One (display) in sentence case, leading .95; on honey add a 3px `--honey-200` offset text-shadow. Nunito (body) 16/1.5, weights 600–800. **Silkscreen** (`--font-pixel`, `.eyebrow`, `.pixel`) is the 8-bit voice: eyebrows (12px, .04em, uppercase, no smoothing), badges, cell status, counts. Space Mono (`--font-mono`) for code, tool calls, repo names and data.
- **Outline + hard shadow:** 2px ink border on every card, control, chip and badge; `--shadow-hard` 4px 4px 0 ink (2px small, 6px dialogs and hover; honey and teal variants for dark surfaces). Buttons, tags and inputs use `--radius-pill` (10px chamfer). Hover lifts 2px into a 6px shadow, no rotation; press shifts 2px into the shadow. Focus is a wax + teal double ring (`--shadow-focus`). Shade with `--dither-ink` / `--dither-wax` / `--dither-honey` checkerboards, never with alpha gradients.
- **Hexagons:** a LearningCell is a pointy-top hexagon cut with `clip-path: var(--hex)`. Three nested layers give ink outline (2px), honey wall (8px, lit from the top left with a hard two-tone split) and face. The hard shadow is `filter: var(--shadow-cell)` on the outer element, since box-shadow cannot follow a clip path.
- **Backgrounds:** wax page. Fields of comb come from `--comb-tile-wax|honey|hive|teal` (generated pixel tiles, used at `--comb-tile-size` with `image-rendering:pixelated`). `--comb-stripes` for honey bands, `--hive-bands` for the skep, `--terminal-scan` for code surfaces. No photography. No purple, no soft gradients.
- **Corners (chamfers):** xs 3, sm 4, md 6 (cards), lg 8 (dialogs, hero), xl/pill 10 (buttons, tags, inputs), round 30% (octagon for knobs, icon buttons, avatars).
- **Spacing:** 4px base; 24px card padding, 16px between groups, 8px within. Controls 36/46/58. Cells 232×264 with a 10px gap. Mobile gutter 16, desktop 32. Containers 640/960/1200; mobile 390.
- **Motion:** two speeds. **Props move in frames**: sprite frames swap with `steps(1)`, bobbing and arriving use `--ease-step` steps(4), flights use `--ease-step-fine` steps(8). **UI stays smooth**: `--ease-out` for fades and hover lifts, `--ease-kick` only for the switch knob. 120ms hover, 200ms toggles, 420ms arrivals, 900ms a cell filling, 1600ms a flight. The loading state is a flying bee. Disabled: 45% opacity, no shadow. Everything stops under `prefers-reduced-motion`.
- **Transparency & blur:** only the dialog scrim (`--scrim`, 12px blur) and glass fills on dark surfaces.
- **Layout:** landing = nav, HiveHero (honey comb field, headline left, comb and bees right, dithered ground strip), then wax sections. Dashboard = 1200px wax column; the comb sits on a `comb-tile-wax` stage; ask and answer side by side on desktop, stacked on mobile.

## ICONOGRAPHY
- Utility glyphs are 12×12 pixel icons drawn in `currentColor` (`icon-check`, `icon-x`, `icon-chevron-down`, `icon-arrow-right`, `icon-plus`, `icon-copy`, `icon-search`, `icon-thumb`, `icon-terminal`, `icon-cell`). Render at whole multiples only: 12, 24, 36.
- Brand glyphs are the props (bee, cell, droplet, flower, jar, magnifier, speech bubble, thumb, hive entrance), not icons.
- No emoji, ever. No third-party logos: Claude and Codex are a clay badge and a teal badge with the same terminal glyph.

## Components (`components/`)
core/: Button, IconButton, Badge, Tag, Card
forms/: Input, Select, Switch
navigation/: Tabs
feedback/: Dialog, Toast, Tooltip
sprites/: Sprite (inline pixel SVG by name), spriteData (generated)
hive/: LearningCell (+ EmptyCell), CombGrid, AskBox, AnswerCard (+ CitationChip, CiteRef), MemberBee, InstallSnippet, ActivityFeed, HiveHero

All styling is class based with an `hm-` prefix in `components/core.css` and `components/hive.css`; the TSX files only set class names. Import `components/ds.css` once (it pulls in `styles.css` and both sheets) and import components from `components/index.ts`. Files that hold state (`AskBox`, `InstallSnippet`, `Tabs`, `Dialog`) are client components; the rest render on the server. To use the system in `apps/web`, copy `design/system/components` to `apps/web/src/components/ds` and `tokens/` + `styles.css` beside it, or import across the workspace.

**Pixel sprites:** every prop is drawn as a character grid in `sprites/art/*.mjs` and compiled by `node sprites/build.mjs` into `sprites/*.svg`, `sprites/sprites.json`, `components/sprites/spriteData.ts` and `tokens/patterns.css`. Sprites use `shape-rendering:crispEdges` and `image-rendering:pixelated` (class `.sprite`), an ink silhouette around flat fills, and frame animation with stepped easing. Keep new props on the grid; never add curves or anti-aliased strokes. See `sprites/README.md`.

## Index
- `styles.css` → `tokens/` fonts.css (Google Fonts import), colors.css, typography.css, spacing.css, effects.css, patterns.css (generated), base.css
- `sprites/` — art grids, build script, 36 SVGs, 4 comb tiles, README
- `components/` — TSX + `core.css`, `hive.css`, `ds.css`, `index.ts`
- `preview.html` / `preview.png` — every token, sprite and component on one page; rebuild with `node preview/build.mjs && node preview/shoot.mjs`
- `marketing-kit.md` — how to make social images in this system

## Fonts
No brand fonts were supplied. Lilita One, Nunito, Space Mono and Silkscreen are loaded from Google Fonts via `tokens/fonts.css`. In the Next.js app, prefer `next/font/google` for the same four families and set `--font-display`, `--font-body`, `--font-mono`, `--font-pixel` from it.
