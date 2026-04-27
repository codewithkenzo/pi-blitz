---
version: 0.1.0
name: pi-blitz
description: Terminal-UI design spec for the `/blitz` overlay in Pi.
surface: tui
reference_pattern: extensions/flow-system/src/deck
design_tokens:
  colors:
    primary: "accent"
    status_idle: "muted"
    status_running: "active"
    status_success: "success"
    status_warning: "warning"
    status_error: "error"
    border: "border"
    label: "label"
    dim: "dim"
  typography:
    family: "monospace (terminal)"
    sizes: ["normal", "compact", "very-narrow"]
  spacing:
    unit_ch: 1
    column_gap_ch: 2
    pill_gap_ch: 2
    section_gap_lines: 1
  motion:
    header_title: "shimmer while edits running, static when idle"
    running_badge: "pulse at 1.5 Hz, static otherwise"
    key_flash: "180 ms highlight on each keystroke"
    token_counter: "count-up animation on new savings"
---

# pi-blitz TUI — DESIGN.md

Source of truth for the `/blitz` overlay. Everything below maps to implementation in `src/ui/` (post-scaffold ticket d1o-guch).

## 0. Status

**Pre-implementation.** Mockup-first workflow per `d1o-guch`:

```
prompts (this doc)  →  UI mockup images  →  human review  →  implement via ctx.ui.custom  →  final review
```

Do not implement until mockups are approved.

## 1. Overview

`/blitz` opens a compact, bottom-anchored overlay that shows:
- the state of the local `blitz` backend (binary present? version? grammar coverage?)
- recent edits in the current Pi session (tool calls, tokens saved, wall-time)
- the last diff blitz produced, scroll-capable
- a keybind pill row so operators can trigger `undo`, `doctor`, and `diff` without leaving the overlay

Anchor + sizing follow flow-deck precedent:
```
overlay: true
anchor: "bottom-center"
offsetY: -2
width: "82%"  (minWidth: 72, shrinks to icon-only at ≤60 ch)
maxHeight: "66%"  (caps below flow-deck so both can coexist)
margin: 1
```

## 2. Colors

Uses existing repo ThemeEngine tokens — **no new color creation**. Map tokens by role:

| Role | Token | Usage |
|---|---|---|
| Accent | `accent` | primary chrome, version number, active badge |
| Label | `label` | titles, section headers |
| Dim | `dim` | inactive keybind labels, separators |
| Muted | `muted` | background info, counters at rest |
| Border | `border` | zone dividers (horizontal only, no full frame) |
| Success | `success` | "edit applied", "undo ok" |
| Warning | `warning` | "parse warning", "partial apply" |
| Error | `error` | "timeout", "binary missing" |
| Active | `active` | "running", pulsing badge |

No custom palette; re-theme automatically via `theme-switcher`.

## 3. Typography

Monospace terminal. Size modes driven by terminal width:

| Mode | Width | Behavior |
|---|---|---|
| `normal` | ≥ 90 ch | Full titles, pill labels, clock with seconds |
| `compact` | 72-89 ch | Shorter titles, clock `HH:MM`, labels abbreviated |
| `very-narrow` | < 72 ch | Icon-only pills, fall back to single-column body |

## 4. Layout (3 zones + footer)

Mirrors flow-deck's 3-zone pattern exactly, sized to coexist below it if both are open.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ⚡ BLITZ    ● RUNNING    saved 2.4k tok    HH:MM:SS                          │   Zone 1: header
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  BACKEND               │   RECENT EDITS                                    │   Zone 2: 2-col
│  binary:   0.1.3       │   ┆ 14:22:03  replace  handleRequest   det  8 ms  │
│  grammars: ts tsx py   │   ┆ 14:21:59  after    helper          det  6 ms  │
│            rs go       │   ┆ 14:21:47  rename   oldName→newName det 12 ms  │
│  cache:    OK (42/50)  │   ┆ 14:20:18  batch×3  src/app.ts      det 18 ms  │
│                        │   ┆ 14:19:52  undo     src/router.ts   det  4 ms  │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  LAST DIFF — src/app.ts  (PgUp/PgDn scrolls)                                │   Zone 3: scroll
│                                                                            │
│    @@ -12,3 +12,7 @@                                                       │
│     function handleRequest(req) {                                          │
│    -  return process(req);                                                 │
│    +  try {                                                                │
│    +    return process(req);                                               │
│    +  } catch (e) {                                                        │
│    +    logger.error(e);                                                   │
│    +    throw e;                                                           │
│    +  }                                                                    │
│     }                                                                      │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  [u] undo  [d] diff  [r] doctor  [esc] close                               │   Footer
└────────────────────────────────────────────────────────────────────────────┘
```

### Zone 1 — header
- Left: `⚡ BLITZ` (shimmer when a tool call is in flight; flat when idle).
- Center-left: status badge. `● RUNNING` pulses at 1.5 Hz; `● IDLE` / `● OK` / `● WARN` / `● ERROR` stay static and use their tone color.
- Center-right: session token-savings counter. Count-up animation (120 ms) when a new edit lands. Rendered `saved 2.4k tok` (compact) or `saved 2,416 output tokens` (normal).
- Right: clock. `HH:MM` in compact, `HH:MM:SS` in normal.

### Zone 2 — two-column body
Left column (24 ch): **backend panel**.
```
BACKEND
binary:   <version> | <red 'MISSING'> | <yellow 'OUTDATED 0.0.1 < 0.1.0'>
grammars: <wrap list, 5 supported>
cache:    OK (used/total)  |  FULL  |  STALE
```

Right column (remainder): **recent edits feed**. Scrolling, last 20 events.
Columns inside the feed:
1. time `HH:MM:SS`
2. tool verb abbreviation (`read` / `edit` / `replace` / `after` / `batch×N` / `rename` / `undo` / `doctor`)
3. target symbol or path (truncate with `…` from the left so suffix stays visible)
4. path (`det` deterministic / `mrg` merge-warn / `err` / `miss` → details-token from soft error)
5. wall-time (`<1 ms` / `8 ms` / `140 ms`)

Use `zipColumns()` from `shared/theme/deck` (exists in flow-system) to pad safely.

### Zone 3 — last diff (scrollable)
- Header line: `LAST DIFF — <file>  (PgUp/PgDn scrolls)` when content overflows.
- Body: unified diff with `+` lines in `success`, `-` lines in `error`, context lines in `dim`, hunk headers in `accent`.
- Strip ANSI + control bytes from blitz stdout before coloring (reuse `stripAnsi` from shared/theme).
- Empty state: `(no edits this session)` rendered in `muted`, no scroll.

### Zone 4 — footer
Keybind pills with flash-on-press:

| Normal | Compact | Very narrow |
|---|---|---|
| `[u] undo  [d] diff  [r] doctor  [/] search  [esc] close` | `[u] [d] [r] [/] [esc]` | `[u] [d] [r] [esc]` |

Pill rendering matches flow-deck `renderFooter` shape; use `KeyFlashState` from flow-deck's `state.ts` directly (import, don't clone).

## 5. Elevation & Depth

TUI has no shadows. Depth via:
- Horizontal `─` dividers between zones (theme-token `border`).
- No left/right frame — overlay is anchor-free on horizontal edges.
- Top and bottom single-line frame.
- Active elements (pulse / shimmer) carry subtle motion as their "elevation".

## 6. Shapes

- Box-drawing: `┌ ─ ┐ │ └ ┘ ├ ┤ ┴`, single-width only.
- Pills use square brackets `[key] label` — same glyphs as flow-deck footer.
- Status dots: `●` (U+25CF).
- Spark icon: `⚡` (U+26A1) in the header.

## 7. Components

### 7.1 `BlitzBadge` — status dot + label
Props: `state: "idle" | "running" | "ok" | "warn" | "error"`.
State → `{ label, tone, pulsing }` map. Pulsing only when `state === "running"`.

### 7.2 `BackendPanel`
Consumes latest `DoctorSnapshot` from `getDoctor()`. Refresh cadence: passive; re-reads cache on overlay focus; runs doctor when user presses `r`.

### 7.3 `RecentEditsFeed`
Pure function over the session's `pi_blitz_metrics` log entries. Last 20, newest at top. Row height = 1. Uses time + tool verb + symbol + status + latency as fixed columns.

### 7.4 `DiffView`
Reads the last blitz stdout from the session telemetry. Scrollable via PgUp/PgDn. Scroll state lives in `BlitzDeckState`.

### 7.5 `KeybindPills`
Reuse flow-deck `renderFooter` impl directly with a different `BINDS` array.

### 7.6 `TokenSavingsCounter`
Reads `pi_blitz_metrics.totalTokensSaved` counter. Count-up animation on change; static otherwise.

## 8. Do's and Don'ts

**Do**
- Reuse flow-deck primitives (`zipColumns`, `AnimationTicker`, `shimmer`, `pulse`, `stripAnsi`, `KeyFlashState`). Never fork.
- Keep overlay anchor + dimensions such that flow-deck and blitz can be open simultaneously without overlap.
- Gate every mutating keybind (none in MVP — `undo` is a confirmation-required tool call initiated from chat, not the overlay).
- Degrade gracefully below 60 ch (icon-only pills, single-column body, no shimmer).
- Always fall back to `ctx.ui.notify` text when `ctx.ui.custom` is unavailable.

**Don't**
- Duplicate flow-deck code. Import, don't copy.
- Add mutating keys directly to the overlay — we keep writes in chat so Pi's tool-confirmation flow stays the only write path.
- Introduce new color tokens. Use theme roles.
- Render diffs wider than the overlay — hard-wrap on word boundary, respect terminal width.
- Animate outside of the shimmer/pulse/flash/count-up set. No spinners, no typewriter effects.

## 9. Accessibility

- Respect `config.animation.reducedMotion` → skip shimmer/pulse/count-up; static rendering.
- Color roles only carry meaning alongside a glyph (dot + word), so color-blind users still see status via `RUNNING` / `OK` / `ERROR` text.
- All keybinds reachable without mouse. Overlay closes on `esc` first, `q` second.

## 10. Motion inventory

| Element | Trigger | Duration | Token |
|---|---|---|---|
| Header title shimmer | tool call in flight | continuous | flow-deck `shimmer` |
| Status badge pulse | `RUNNING` state | 1.5 Hz | flow-deck `pulse` |
| Key-flash | keystroke | 180 ms | flow-deck `KeyFlashState` |
| Token counter count-up | metric delta | 120 ms | new; simple easing |

`AnimationTicker` starts on overlay focus, stops on dispose. Single instance per overlay.

## 11. Non-goals

- Not an editor. No in-overlay text input.
- Not a git interface. Undo + diff come from blitz's own backup store only.
- Not a benchmark dashboard (ticket `d1o-gso9` owns that surface separately).
- No multi-overlay split views. One blitz overlay at a time.

## 12. Reference images

Drop mockup images under `extensions/pi-blitz/docs/media/mockups/` once they land:

```
docs/media/mockups/
├── blitz-overlay-normal.png        ← 100+ ch terminal
├── blitz-overlay-compact.png       ← 72-89 ch
├── blitz-overlay-narrow.png        ← 60-71 ch
├── blitz-state-idle.png
├── blitz-state-running.png
├── blitz-state-error-missing.png   ← binary not found state
└── blitz-diff-scrolled.png         ← PgDn-scrolled diff view
```

Image prompts for each state are in `docs/mockup-prompts.md` (ticket `d1o-guch` sub-task).

## 13. Open questions for mockup review

Answer these before implementation:

1. **Header density.** `⚡ BLITZ  ● RUNNING  saved 2.4k tok  HH:MM:SS` — does the counter go in the header or move to the backend panel footer?
2. **Diff in Zone 3 — full width or indented?** Current mockup shows 4-ch indent. Alternative: flush-left with `border` vertical rail.
3. **Status badge position.** Left of counter (current), or right of clock?
4. **Scroll affordance.** Show `↓ 3 more lines` hint when diff overflows? Or only the Zone 3 title note?
5. **Empty backend state.** When `binary: MISSING`, collapse Zone 2 into a full-width install-hint block, or keep 2-col with `RECENT EDITS` still visible?
