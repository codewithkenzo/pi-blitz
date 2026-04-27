# @codewithkenzo/pi-blitz

Pi extension wrapping the [`blitz`](https://github.com/codewithkenzo/blitz) AST-aware symbol-scoped edit CLI.

## Status

**Alpha — version 0.1.0-alpha.0.** Requires blitz CLI 0.1.0-alpha.0. No prebuilt binaries published yet; build blitz from source and configure the path (see Install).

Blitz is not a universal replacement for core `edit`. It is most effective for large preserved bodies and structural symbolic edits. Tiny or one-line edits often favor core `edit` directly.

## Tools

15 tools registered:

| Tool | Purpose |
|---|---|
| `pi_blitz_read` | AST structure summary (imports + declaration ranges). |
| `pi_blitz_edit` | Single symbol-anchored edit. Exactly one of `after`/`replace` required. |
| `pi_blitz_batch` | Multiple symbol-anchored edits in one file. |
| `pi_blitz_apply` | Structured edit via JSON IR — operation + target + edit payload. |
| `pi_blitz_replace_body_span` | Replace an exact span inside a symbol body. |
| `pi_blitz_insert_body_span` | Insert text before or after an anchor inside a symbol body. |
| `pi_blitz_wrap_body` | Wrap a symbol body without repeating it. |
| `pi_blitz_compose_body` | Preserve multiple body islands while rewriting the rest. |
| `pi_blitz_multi_body` | Multiple body-scoped edits in one atomic apply. |
| `pi_blitz_patch` | Compact tuple patch ops: `replace`, `insert_after`, `wrap`, `replace_return`, `try_catch`. |
| `pi_blitz_try_catch` | Narrow semantic wrapper for `try_catch` patch ops. |
| `pi_blitz_replace_return` | Narrow semantic wrapper for `replace_return` patch ops. |
| `pi_blitz_rename` | AST-verified rename in one file (skips strings/comments). |
| `pi_blitz_undo` | Revert last blitz edit. Requires `confirm: true`. |
| `pi_blitz_doctor` | Version, supported grammars, cache health. |

## Benchmark evidence

Two authenticated Pi/model benchmark runs (N=5, `gpt-5.4-mini`):

**Benchmark 1 — medium-10k / wrap_body, both lanes 100% correct:**

| Metric | pi core `edit` | `pi_blitz_wrap_body` | Reduction |
|---|---|---|---|
| Provider output tokens (median) | 9,639 | 85 | 99.1% |
| Tool-call arg tokens (median) | 9,624 | 65 | 99.3% |
| Wall time (median) | 61,699 ms | 3,919 ms | 93.6% |
| Cost (sum, N=5) | $0.2453 | $0.0321 | 86.9% |

**Benchmark 2 — multi / large-structural:**

Core attempt: 0% correct (comparator failed on a large structural patch). `pi_blitz_patch`: 100% correct.

| Metric | Core attempt (failed) | `pi_blitz_patch` | Reduction |
|---|---|---|---|
| Provider output tokens (median) | 9,739 | 108 | 98.9% |
| Tool-call arg tokens (median) | 9,689 | 89 | 99.1% |
| Wall time (median) | 86,839 ms | 3,211 ms | 96.3% |
| Cost (sum, N=5) | $0.2972 | $0.0310 | 89.6% |

**Caveats:** Benchmark 2 compares a correct blitz result against a failed core attempt — not two correct results. Efficiency claims for that benchmark reflect the failed baseline. Benchmark 1 is a fair comparison (both lanes correct). Tiny or one-line edits are outside blitz's effective range.

## Install

No prebuilt binaries are published yet. Build `blitz` from source at [codewithkenzo/blitz](https://github.com/codewithkenzo/blitz), then configure the extension to point at your binary via `~/.pi/pi-blitz.json`:

```json
// ~/.pi/pi-blitz.json
{ "binary": "/abs/path/to/blitz" }
```

Install the extension:

```bash
# from source
pi install /abs/path/to/pi-plugins-repo-kenzo/extensions/pi-blitz

# npm (once published)
pi install npm:@codewithkenzo/pi-blitz
```

Verify: `/help` should list all 15 `pi_blitz_*` tools.

## MCP alternative

A standalone MCP server for blitz is available at [codewithkenzo/blitz](https://github.com/codewithkenzo/blitz). Use it for environments where a Pi extension is not available.

## Config

`~/.pi/pi-blitz.json` points the extension at a specific `blitz` binary. The `binary` field is user-only and cannot be overridden from a project-level `.pi/pi-blitz.json`.

```ts
type PiBlitzConfig = {
  binary?: string; // absolute path or command name on PATH
};
```

## Architecture

Effect v4 internals (typed error union via `Data.TaggedError`, per-path mutex via `Effect.acquireUseRelease`, `Cause.findErrorOption` boundary). Effect stays internal; Pi tool `execute` is the Promise/`AgentToolResult` boundary.

File layout:

```
extensions/pi-blitz/
  index.ts            # register tools, Effect boundary
  src/
    errors.ts         # Data.TaggedError union
    tool-runtime.ts   # Effect.runPromiseExit + Cause discrimination
    tools.ts          # tools → spawnCollect(blitz …)
    doctor.ts         # Effect.cached binary/version probe
    paths.ts          # canonical realpath + symlink escape guard
    mutex.ts          # per-path acquireUseRelease
    config.ts         # user/project config loader
  skills/pi-blitz/SKILL.md
  package.json
  README.md
```

## Design reference

Full spec, CLI surface, edit algorithm, layer pipeline, Zig 0.16 alignment, and full benchmark data: `codewithkenzo/blitz/docs/blitz.md`.

## License

MIT.
