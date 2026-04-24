# How pi-blitz fits the Pi / LLM stream

The extension matters less than what the language model actually sees. This doc maps each `pi_blitz_*` tool call to the exact sequence that lands in the LLM's context, what's spent, and how the installed Pi extensions transform it along the way.

## 1. Lifecycle of a single `pi_blitz_edit` call

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. Model emits tool_call                                                     │
│    name: pi_blitz_edit                                                        │
│    args: { file, snippet, after|replace }                                    │
│    → cost: small args payload (tokens in)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
            ↓  ExtensionAPI.execute()
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. TypeBox validate params                                                   │
│    → runtime byte cap (TextEncoder UTF-8 length, not .length)                │
│    → XOR guard: exactly one of after | replace                               │
│    failure → throw InvalidParamsError → isError: true in chat                │
└──────────────────────────────────────────────────────────────────────────────┘
            ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. canonicalize(file, cwd) via realpath + symlink escape guard               │
│    failure → throw PathEscapeError (hard, not retryable by LLM)              │
└──────────────────────────────────────────────────────────────────────────────┘
            ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. Acquire per-file mutex via Effect.acquireUseRelease                       │
│    (concurrent pi_blitz_edit on same file will queue, not race)              │
└──────────────────────────────────────────────────────────────────────────────┘
            ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 5. spawnCollect([blitz, edit, <abs>, --snippet, -, --replace, <sym>])        │
│    stdin: user snippet (bytes)                                               │
│    env: FASTEDIT_NO_UPDATE_CHECK=1, BLITZ_NO_UPDATE_CHECK=1                  │
│    timeout: 60s                                                              │
│    → spawn failures:                                                         │
│      ENOENT / not-found / exit 127 → BlitzMissingError (hard)                │
│      exit 124 / timeout            → BlitzTimeoutError (hard)                │
└──────────────────────────────────────────────────────────────────────────────┘
            ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 6. Parse stdout → classify                                                   │
│    exit 0:                                                                   │
│      "Applied edit to <f>. latency: Xms ..."  → plain success                │
│      "Warning: ... chunk(s) rejected. Partial edit applied." → warning/partial│
│      "Warning: merged output has parse errors" → warning                     │
│      "needs_host_merge {...json...}"        → Layer D fallback               │
│    exit 1 → soft error with details.reason                                   │
│    exit 2 → RequiresForceError (delete only, not in v0.1)                    │
└──────────────────────────────────────────────────────────────────────────────┘
            ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 7. Effect.runPromiseExit at boundary (index.ts → runTool)                    │
│    Exit.isSuccess → AgentToolResult { content, details }                     │
│    Exit.isFailure + BlitzSoftError → { isError: true, details }              │
│    Exit.isFailure + hard error → throw (pi-mono marks call failed in chat)   │
└──────────────────────────────────────────────────────────────────────────────┘
            ↓
┌──────────────────────────────────────────────────────────────────────────────┐
│ 8. Pi chat: tool_result appears in stream                                    │
│    → content[0].text = verbatim blitz stdout (for humans)                    │
│    → details = { reason? status? warning? partial? parseFallback? degraded? }│
│    → isError presence signals retry-with-different-args opportunity          │
└──────────────────────────────────────────────────────────────────────────────┘
            ↓  tool_result enters model context on next turn
┌──────────────────────────────────────────────────────────────────────────────┐
│ 9. Extensions decorate what the LLM ultimately sees                          │
│    pi-tool-codex: diff rendering + output-mode styling                       │
│    pi-rtk-optimizer: source-code filtering + smartTruncate at 220 lines      │
│    → LLM context = trimmed, compacted, structured view                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 2. What the model sees (token math)

Baseline comparison for a single wrap-in-try-catch on a 40-line function.

### Pi core `edit` tool call

```
model output tokens:
  oldText: 40 lines × ~8 tokens   ≈ 320 tokens
  newText: 44 lines × ~8 tokens   ≈ 352 tokens
  tool-call wrapper + args        ≈  40 tokens
TOTAL ≈ 712 output tokens
```

### `pi_blitz_edit` call

```
model output tokens:
  args.snippet: just the try/catch wrap + "// @keep" marker ≈ 35 tokens
  args.after/replace: symbol name                            ≈   3 tokens
  args.file: path                                            ≈   5 tokens
  tool-call wrapper                                          ≈  30 tokens
TOTAL ≈ 73 output tokens
```

**Savings: ~90% on that specific edit shape.** On the result side both show a short success line + diff, so result tokens are equivalent (~60-120 tokens either way).

Across the mocked 10-case benchmark (see `blitz.md` §10.1) the weighted target is **40-50% total output-token reduction**. Per-case range: 0% (trivial insert — core is already minimal) to ~90% (structural wrap with marker).

## 3. Streaming semantics

### Current v0.1 shape: **one-shot, no streaming**

- `pi_blitz_*` tools spawn blitz, wait for exit, return the single text block + details.
- blitz itself is one-shot (Python fastedit was too); emits a single final stdout block.
- `onUpdate` callback not used in MVP — no partial progress events.

**What the chat stream shows during a call:**
```
▸ pi_blitz_edit  file=src/app.ts  replace=handleRequest  snippet=…(35 tok)
  [running]       ← Pi's own running indicator, not ours
```

### Deferred streaming options

If we want in-progress feedback in v0.2:

| Option | What the LLM sees mid-call | Cost |
|---|---|---|
| Emit `onUpdate({ text: "...", details: { phase: "parsing" } })` | Status ticks in chat | +1-2 tool_update events per call |
| Include `TokenSavingsCounter` delta in the overlay only | No chat noise | zero LLM impact |
| Push a terse `onUpdate` only on Layer D fallback | Signals to LLM "you'll need to merge via `edit`" before the result lands | neutral |

Recommend **overlay-only** progress for v0.2 — keep chat signal-to-noise high.

## 4. How installed Pi plugins transform the stream

### `pi-tool-codex` (`~/.pi/agent/extensions/pi-tool-codex`)
- Overrides the `write` tool; does **not** override `edit` or any `pi_blitz_*`.
- Wraps all tool results in a compact renderer: preview (8 lines) + expandable (4000 lines).
- `diffViewMode: "auto"` — our stdout diff tail renders as unified on wide terminals, compact on narrow.
- **Impact on pi-blitz:** stdout diff tails get the same visual treatment as any other tool. No changes needed on our side.

### `pi-rtk-optimizer` (`~/.pi/agent/extensions/pi-rtk-optimizer`)
- `outputCompaction.enabled: true` — hooks `tool_result` and compacts.
- `sourceCodeFiltering: "minimal"` + `smartTruncate.maxLines: 220` — our diff/stdout is allowed up to 220 lines per call, then truncated.
- `trackSavings: true` — the LLM never sees the RTK compaction; it sees the compacted version.
- **Impact on pi-blitz:** diff tails longer than 220 lines get truncated. This is fine (the overlay's Zone 3 has its own scroll); but for very long refactors we should be aware.

### `pi-fff` + `pi-shared`
- No effect on pi-blitz tool_result path.
- `pi-fff` may provide path candidates for `args.file` upstream (before our tool call).

### Combined context footprint per call

For a typical `pi_blitz_edit` success:

```
tool_call args:         ~50-100 in-tokens
tool_result:
  content text:         ~80-150 tokens (diff tail capped at 220 lines by RTK)
  details object:       ~15-30 tokens (reason/warning/status keys)
```

Total round trip: **~150-280 tokens** (compact case) to **~400-500 tokens** (diff-heavy case). Pi core `edit` on the same work: **~500-1200 tokens**.

## 5. Error → LLM retry flow

Matrix of what happens when each error class fires, by what the LLM sees + what the LLM can do about it.

| Class | `isError` | `details.reason` | LLM self-correction path |
|---|---|---|---|
| `InvalidParamsError` | throw → hard fail | — | LLM must re-emit with fixed args (common: set exactly one of `after`/`replace`) |
| `ConfirmRequiredError` | throw → hard fail | — | LLM must re-ask user for confirm: true |
| `BlitzMissingError` | throw → hard fail | — | LLM sees "binary not found"; the agent should advise user to install blitz, stop trying |
| `BlitzVersionError` | throw → hard fail | — | Same as above |
| `BlitzTimeoutError` | throw → hard fail | — | LLM can retry (once) with a smaller snippet or fall back to core `edit` |
| `PathEscapeError` | throw → hard fail | — | LLM must pass an in-workspace path |
| `BlitzSoftError(no-undo-history)` | `isError: true` | `"no-undo-history"` | LLM backs off; signals "nothing to revert" |
| `BlitzSoftError(no-occurrences)` | `isError: true` | `"no-occurrences"` | LLM re-searches for the correct symbol; retries with different name |
| `BlitzSoftError(no-references)` | `isError: true` | `"no-references"` | Same |
| `BlitzSoftError(blitz-error)` | `isError: true` | `"blitz-error"` + stderr | LLM reads stderr; retries if obvious fix, escalates if not |
| Success + `needs_host_merge` | no isError | `status: "needs_host_merge"` | LLM reads scope payload + calls core `edit` with narrow context (Layer D fallback) |
| Success + warning | no isError | `warning: "partial-edit"` or `"parse-error-post-write"` | LLM runs `pi_blitz_diff` to inspect; may issue follow-up edit |
| Success + degraded | no isError | `degraded: true` | `tldr` missing locally; LLM reads line count only |
| Plain success | no isError | none | Move on |

Key property: **hard errors throw** so pi-mono shows them as red tool failures; **soft errors return `isError: true`** which the LLM reads and can branch on. This matches the pi-mono convention so the agent behaves consistently across tools.

## 6. The `/blitz` overlay vs the chat stream

Two independent surfaces:

| Surface | Audience | Token cost | Update cadence |
|---|---|---|---|
| Chat `tool_result` | LLM + human | **billable** | one per tool call |
| `/blitz` overlay | human only | **zero** | passive polling of session state |

The overlay reads the same session custom entries (`pi_blitz_metrics` — ticket `d1o-mq74` polish) that telemetry writes from `agent_end`. **Nothing the overlay shows ever enters the LLM context.** That's the point: observability without tax.

Important: the overlay never initiates mutation. `undo`, `doctor`, and `diff` keybinds are **reference-only** in v0.1. Writes continue to flow via chat + pi-mono's confirm prompt. If we ever want in-overlay actions, they should round-trip back through `registerTool` so the confirm + telemetry + audit path stays single.

## 7. What this unlocks for the agent

- **More tool calls per turn for the same output budget.** At 40-50% savings, budget for 2-3 edits becomes budget for 4-5.
- **Cleaner diff context.** The LLM sees the diff tail, not the whole file. Keeps later-turn context tight.
- **Explicit fallback signal.** Layer D `needs_host_merge` tells the LLM "stop trying here, pivot to core edit". No silent flailing.
- **Deterministic-first behavior.** 74% of edits hit the deterministic splice path with zero structural risk from model hallucination at the merge step.

## 8. Open v0.2 questions that affect stream fit

1. **Batch tool_result chunking.** Should `pi_blitz_batch` emit one `tool_result` with N lines, or N `onUpdate` events? First is compact; second gives progressive feedback.
2. **RTK coordination.** Should we ask RTK to exempt our diff tails from source-code filtering? Diffs are already compressed context; double-compaction could drop critical lines.
3. **Layer D payload size.** Current spec says "~35 lines excerpt". In a crowded chat context that's ~150-300 tokens per fallback. Consider 15-line excerpt as default with `?expand=true` option.
4. **Telemetry budget.** `pi_blitz_metrics` entry in session state grows per edit. Cap at last-100 entries to prevent session-memory bloat.

Answer these before v1.0 ships.

## Cross-references

- `extensions/pi-blitz/src/tools.ts` — wiring of this flow
- `extensions/pi-blitz/src/tool-runtime.ts` — boundary (Effect.runPromiseExit + Cause.findErrorOption)
- `docs/architecture/blitz.md` §6 — full error taxonomy
- `docs/architecture/blitz.md` §10 — benchmark gate (numbers here are hypotheses until that runs)
- `extensions/pi-blitz/skills/pi-blitz/SKILL.md` — what the agent is actually told about these tools
