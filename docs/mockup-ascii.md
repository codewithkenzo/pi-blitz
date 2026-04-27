# pi-blitz `/blitz` overlay — ASCII baseline mockups

Lossless baseline of each DESIGN.md §4 variant. Image mockups in `mockup-prompts.md` map onto these exactly. When prompts drift, these are the reference.

## 1. Normal — 100 columns, running state

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ⚡ BLITZ    ● RUNNING    saved 2,416 output tokens                                    14:22:03  │
├──────────────────────────┬─────────────────────────────────────────────────────────────────────┤
│ BACKEND                  │ RECENT EDITS                                                        │
│ binary:   0.1.3          │ 14:22:03  replace   handleRequest          det    8 ms              │
│ grammars: ts tsx py      │ 14:21:59  after     helper                 det    6 ms              │
│           rs go          │ 14:21:47  rename    oldName → newName      det   12 ms              │
│ cache:    OK (42/50)     │ 14:20:18  batch×3   src/app.ts             det   18 ms              │
│                          │ 14:19:52  undo      src/router.ts          det    4 ms              │
├──────────────────────────┴─────────────────────────────────────────────────────────────────────┤
│ LAST DIFF — src/app.ts   (PgUp/PgDn scrolls)                                                   │
│                                                                                                │
│    @@ -12,3 +12,7 @@                                                                           │
│     function handleRequest(req) {                                                              │
│    -  return process(req);                                                                     │
│    +  try {                                                                                    │
│    +    return process(req);                                                                   │
│    +  } catch (e) {                                                                            │
│    +    logger.error(e);                                                                       │
│    +    throw e;                                                                               │
│    +  }                                                                                        │
│     }                                                                                          │
│                                                                                                │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│   [u] undo   [d] diff   [r] doctor   [/] search   [esc] close                                  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Compact — 80 columns

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⚡ BLITZ   ● RUNNING   saved 2.4k tok                              14:22      │
├───────────────────────┬──────────────────────────────────────────────────────┤
│ BACKEND               │ RECENT EDITS                                         │
│ bin:   0.1.3          │ 14:22  replace  handleRequest      det    8 ms       │
│ gram:  ts tsx py      │ 14:22  after    helper             det    6 ms       │
│        rs go          │ 14:22  rename   oldName→newName    det   12 ms       │
│ cache: OK (42/50)     │ 14:20  batch×3  src/app.ts         det   18 ms       │
├───────────────────────┴──────────────────────────────────────────────────────┤
│ LAST DIFF — src/app.ts  (PgUp/PgDn)                                          │
│   @@ -12,3 +12,7 @@                                                          │
│    function handleRequest(req) {                                             │
│   -  return process(req);                                                    │
│   +  try {                                                                   │
│   +    return process(req);                                                  │
│   +  } catch (e) {                                                           │
│   +    throw e;                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  [u] undo  [d] diff  [r] doctor  [esc] close                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 3. Very-narrow — 64 columns, icon-only pills, single-column body

```
┌──────────────────────────────────────────────────────────────┐
│ ⚡ BLITZ  ● RUN               saved 2.4k tok        14:22     │
├──────────────────────────────────────────────────────────────┤
│ BACKEND  0.1.3  │ ts tsx py rs go │ cache OK 42/50            │
├──────────────────────────────────────────────────────────────┤
│ 14:22  replace  handleRequest      det   8 ms                 │
│ 14:21  after    helper             det   6 ms                 │
│ 14:21  rename   oldName→newName    det  12 ms                 │
├──────────────────────────────────────────────────────────────┤
│ LAST DIFF — src/app.ts                                        │
│  @@ -12,3 +12,7 @@                                            │
│  -  return process(req);                                      │
│  +  try { return process(req); } catch (e) { throw e; }       │
├──────────────────────────────────────────────────────────────┤
│  [u]  [d]  [r]  [esc]                                         │
└──────────────────────────────────────────────────────────────┘
```

## 4. Idle — no activity this session

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ⚡ BLITZ    ● IDLE    (no edits this session)                                          14:22:03  │
├──────────────────────────┬─────────────────────────────────────────────────────────────────────┤
│ BACKEND                  │                                                                     │
│ binary:   0.1.3          │              (no edits yet — try pi_blitz_edit)                     │
│ grammars: ts tsx py      │                                                                     │
│           rs go          │                                                                     │
│ cache:    OK (0/50)      │                                                                     │
├──────────────────────────┴─────────────────────────────────────────────────────────────────────┤
│ LAST DIFF                                                                                      │
│                                                                                                │
│                              (no diff to show)                                                 │
│                                                                                                │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│   [u] undo   [d] diff   [r] doctor   [/] search   [esc] close                                  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 5. Error — `blitz` binary missing

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ⚡ BLITZ    ● ERROR    blitz binary missing                                           14:22:03  │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                │
│   blitz binary not found on PATH.                                                              │
│                                                                                                │
│   Install with:   npm install -g @codewithkenzo/blitz                                          │
│   or point ~/.pi/pi-blitz.json at a local build:                                               │
│       { "binary": "/absolute/path/to/blitz" }                                                  │
│                                                                                                │
│   Then press [r] to rerun doctor.                                                              │
│                                                                                                │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│ LAST DIFF                                                                                      │
│                             (disabled until doctor passes)                                     │
├────────────────────────────────────────────────────────────────────────────────────────────────┤
│   [u] undo   [d] diff   [r] doctor *pulses*   [esc] close                                      │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 6. Diff scrolled — mid-file view

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ⚡ BLITZ    ● OK    saved 2,416 output tokens                                         14:22:03  │
├──────────────────────────┬─────────────────────────────────────────────────────────────────────┤
│ BACKEND                  │ RECENT EDITS                                                        │
│ binary:   0.1.3          │ 14:22:03  replace   handleRequest          det    8 ms              │
│ grammars: ts tsx py      │ 14:21:59  after     helper                 det    6 ms              │
│           rs go          │ 14:21:47  rename    oldName → newName      det   12 ms              │
│ cache:    OK (42/50)     │ 14:20:18  batch×3   src/app.ts             det   18 ms              │
│                          │ 14:19:52  undo      src/router.ts          det    4 ms              │
├──────────────────────────┴──────────────────────────────────┬─────────────────────────────────┤
│ LAST DIFF — src/app.ts              ↑ 14 lines   ↓ 6 lines  │                                  ┃
│                                                             │                                  ┃
│    @@ -34,5 +34,8 @@                                        │                                  ┃
│     function logResponse(res) {                             │                                 ▓▓│
│    -  console.log(res);                                     │                                 ▓▓│
│    +  if (config.verbose) console.log(res);                 │                                 ▓▓│
│    +  metrics.record(res.status);                           │                                  ┃
│     }                                                       │                                  ┃
│                                                             │                                  ┃
├─────────────────────────────────────────────────────────────┴──────────────────────────────────┤
│   [u] undo   [d] diff   [r] doctor   [/] search   [esc] close                                  │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

(Scrollbar column shown on the right; `▓▓` = thumb in accent, `┃` = track.)

## Checks before rendering images

1. Column alignment: every `│` divider in the same char column.
2. Header clock right-aligned consistently — one trailing space.
3. Pill spacing: 3 ch between pills in normal, 2 ch in compact, 1 ch in very-narrow.
4. Status badge tokens: `● RUNNING` / `● IDLE` / `● OK` / `● WARN` / `● ERROR` are the only five.
5. Empty states say what to do next, not just "nothing here".
6. Error state always gives a copy-pasteable command.

Once these ASCII baselines are approved, generate the 6 PNG mockups from `mockup-prompts.md`, confirm they match, then we start `d1o-guch` implementation.
