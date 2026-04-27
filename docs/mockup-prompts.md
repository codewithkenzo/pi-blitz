# pi-blitz `/blitz` overlay — mockup image prompts

For ticket **d1o-guch**. Run the prompts below through Runware / Stitch / Figma screenshot or hand-draft in a terminal, drop PNG outputs into `extensions/pi-blitz/docs/media/mockups/`, then review before implementation.

## Common brief (prepend to every prompt)

> Terminal UI screenshot, dark theme, single monospace font (JetBrains Mono or Berkeley Mono), 14 pt, high-contrast but not neon, box-drawing Unicode chars (`┌─┐│└┘├┤`), no icons that aren't plain ASCII/Unicode, no gradients, no shadows. Background: near-black `#0a0a0c`. Foreground: warm off-white `#e8e6de`. Accent: electric blue `#5aa9ff`. Muted: `#6b6b73`. Dim: `#3f3f47`. Success: `#7ed491`. Warning: `#f0b94b`. Error: `#ef6262`. Border: `#2a2a32`. No 3D effects. No window chrome beyond what's drawn in text. Render exactly at 14 pt monospace to preserve character alignment. Aspect ratio matches the character grid width × 0.6 px lines.

## 6 mockups to produce

### 1. `blitz-overlay-normal.png` — baseline, idle-ish but active

**Canvas.** 100 columns × 18 rows. Single bottom-anchored panel.

**Prompt to image model:**

```
Render a terminal overlay panel anchored at the bottom-center of a terminal window that is 120 columns wide and 40 rows tall. The overlay itself is 100 columns wide and 18 rows tall. Other terminal text faintly visible above and below the panel, dimmed. Draw the panel with single-line box-drawing characters, three horizontal dividers splitting it into four zones (header, body, diff, footer). Zone heights: header 1 row, body 6 rows, diff 8 rows, footer 1 row.

Header row (left to right): glyph "⚡" then "BLITZ" in accent blue, two spaces, filled dot "●" followed by "RUNNING" in active blue with a subtle glow, two spaces, "saved 2,416 output tokens" in muted, right-aligned clock "14:22:03" in dim. Title shimmer simulated by a slight highlight on the letter "L" of BLITZ.

Body is two columns separated by a single vertical bar "│" in border color at roughly column 26.

Left body column header "BACKEND" in label color. Four rows under it, aligned left:
  binary:   0.1.3
  grammars: ts tsx py
            rs go
  cache:    OK (42/50)

Right body column header "RECENT EDITS" in label color. Five rows, each with 4 columns separated by light spacing:
  14:22:03  replace   handleRequest          det   8 ms
  14:21:59  after     helper                 det   6 ms
  14:21:47  rename    oldName→newName        det  12 ms
  14:20:18  batch×3   src/app.ts             det  18 ms
  14:19:52  undo      src/router.ts          det   4 ms
First column is time in dim, second is verb in accent, third is symbol in off-white, fourth is status in success green, fifth is latency in dim.

Diff zone. First line: "LAST DIFF — src/app.ts  (PgUp/PgDn scrolls)" in label color, left-aligned with 2-space indent. Empty line. Then a unified diff block indented 4 spaces, using:
  @@ -12,3 +12,7 @@          in accent, dim background
   function handleRequest(req) {     in off-white (context)
  -  return process(req);             in error red (removal)
  +  try {                            in success green (addition)
  +    return process(req);           success green
  +  } catch (e) {                    success green
  +    logger.error(e);               success green
  +    throw e;                       success green
  +  }                                success green
   }                                  off-white (context)

Footer row centered: pills in dim square brackets containing accent key:
  [u] undo   [d] diff   [r] doctor   [/] search   [esc] close
Spacing of 3 spaces between pills, 2 spaces padding on each side.

No cursor visible. No selection highlight. Background of the panel itself is the same near-black as terminal, no fill.
```

### 2. `blitz-overlay-compact.png` — 80-column terminal

Same content pared down for a 80 × 36 terminal (overlay 78 × 16). Abbreviate:
- `saved 2,416 output tokens` → `saved 2.4k tok`
- Clock `14:22:03` → `14:22`
- Backend column shrinks to 22 ch
- Right feed column shows 4 rows instead of 5
- Diff shows 6 rows instead of 9

Pills stay with labels: `[u] undo  [d] diff  [r] doctor  [esc] close` (drop `/` search).

### 3. `blitz-overlay-narrow.png` — 64-column terminal, icon-only pills

Terminal 64 × 30, overlay 62 × 14. Single-column body (no left/right split). Order stacked: header, backend (3 lines), recent edits (3 rows), diff (4 rows), footer. Footer pills become icon-only: `[u]  [d]  [r]  [esc]`. Token counter moves to its own single-row strip under header.

### 4. `blitz-state-idle.png` — no recent activity

Same 100-column canvas as #1 but:
- Header: `⚡ BLITZ   ● IDLE   (no edits this session)   14:22:03`. Badge is muted, not blue. No shimmer on title.
- Body left column: backend panel unchanged.
- Body right column: empty state `(no edits yet — try pi_blitz_edit)` centered in muted color.
- Diff zone body: `(no diff to show)` centered in muted color.
- Footer unchanged.

### 5. `blitz-state-error-missing.png` — `blitz` binary not on PATH

Same canvas as #1 but:
- Header badge: `● ERROR  blitz binary missing` in error red. No pulse.
- Body collapses into a single full-width error card:
  ```
  blitz binary not found on PATH.
  Install with:  npm install -g @codewithkenzo/blitz
  or point ~/.pi/pi-blitz.json at your local build:
    { "binary": "/absolute/path/to/blitz" }
  Then press [r] to rerun doctor.
  ```
- Diff zone shows `(disabled until doctor passes)` in dim.
- Footer: `[r] doctor` key pulses at 1 Hz (static render — caption says "pulsing").

### 6. `blitz-diff-scrolled.png` — scroll indicator visible

Same canvas as #1 but:
- Diff zone title includes `↑ 14 lines   ↓ 6 lines` in dim at the right end of the title line.
- Diff body shows mid-scroll content (a later hunk, `@@ -34,5 +34,8 @@`).
- Scroll-bar column in the Zone 3 right edge: 8-row track with a 3-row thumb in accent color; thumb position ~60% down.
- Everything else identical.

## Review checklist (before implementation)

- [ ] Zone boundaries land on exact character columns — no subpixel drift.
- [ ] Spacing between pills consistent (3 ch in normal, 1 ch in very-narrow).
- [ ] Diff additions/removals visually distinct even in grayscale.
- [ ] Empty state wording reads as helpful, not apologetic.
- [ ] `ERROR` state gives the operator an action, not just a message.
- [ ] Scroll affordances (arrow, count, thumb) readable at a glance.
- [ ] Counter animation looks right on a still image (subtle leading zeros shift implied).

## Iteration protocol

1. Generate image via prompt.
2. Diff against the spec's Section 4 layout (columns, heights, dividers).
3. Adjust prompt wording if the render drifts (common drifts: box corners become `+`, spacing collapses, pill brackets lost).
4. Lock version once all 6 mockups agree with DESIGN.md.
5. Commit to `docs/media/mockups/` + update ticket `d1o-guch` with thumbnails.

## Runware direct prompt variants

If using Runware / similar with fewer character tokens, compress to:

```
Dark terminal UI overlay, monospace, 100 cols × 18 rows, box-drawing chars, 4 zones divided by ── lines. Header: "⚡ BLITZ ● RUNNING saved 2.4k tok 14:22:03". Two-column body: left "BACKEND binary 0.1.3, grammars ts tsx py rs go, cache OK (42/50)", right "RECENT EDITS" with 5 rows of time/verb/symbol/status/latency. Diff zone unified diff with try/catch wrap, `+` lines green, `-` lines red. Footer pills "[u] undo [d] diff [r] doctor [esc] close". Colors: bg #0a0a0c, fg #e8e6de, accent #5aa9ff, success #7ed491, error #ef6262, muted #6b6b73. No shadows, no gradients, no window chrome.
```

## Acceptance per ticket `d1o-guch`

- 6 PNGs in `docs/media/mockups/`
- All match DESIGN.md §4 layout
- Open-question answers (DESIGN.md §13) resolved with short rationale written back into DESIGN.md
- **Then** implementation starts — not before.
