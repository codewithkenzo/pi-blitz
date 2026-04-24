# @codewithkenzo/pi-blitz

Pi extension that wraps the [`blitz`](https://github.com/codewithkenzo/blitz) AST-aware fast-edit CLI.

> **Status: pre-alpha scaffold.** Six tool slots registered, binary link gated on the standalone `blitz` CLI v0.1 landing (tickets `d1o-qphx` → `d1o-cewc`).

## What you get

- 6 tools: `pi_blitz_read`, `pi_blitz_edit`, `pi_blitz_batch`, `pi_blitz_rename`, `pi_blitz_undo`, `pi_blitz_doctor`.
- Effect v4 internals (typed error union, per-path mutex via `acquireUseRelease`, `Cause.findErrorOption` boundary).
- ~40-50% output-token savings on handled edits (hypothesis, gated on benchmark `d1o-gso9`).
- Single prebuilt binary per platform (no Python, no local model).

## Install

Requires `blitz` binary on `PATH`. Either:

- `npm install -g @codewithkenzo/blitz` (once published; pulls the prebuilt binary for your platform).
- or point `~/.pi/pi-blitz.json` at your built binary:
  ```json
  { "binary": "/abs/path/to/blitz" }
  ```

Then install the Pi extension:

```bash
pi install npm:@codewithkenzo/pi-blitz
# or from source:
pi install /abs/path/to/pi-plugins-repo-kenzo/extensions/pi-blitz
```

Verify: `/help` should list the six `pi_blitz_*` tools.

## Config

`~/.pi/pi-blitz.json` (user-level) + `.pi/pi-blitz.json` (project-level). User-only keys are `binary` and `trustedExternalPaths` — project config cannot override them.

```ts
type PiBlitzConfig = {
  binary?: string;                 // user-only; absolute path to blitz
  trustedExternalPaths?: boolean;  // user-only; allow paths outside cwd
  defaultTimeoutMs?: number;       // default 60_000 for edit, 30_000 otherwise
  cacheDir?: string;               // overrides ~/.cache/blitz
  noUpdateCheck?: boolean;
};
```

## Design

See `codewithkenzo/pi-rig/docs/architecture/blitz.md` for the full spec (CLI surface, error taxonomy, Effect v4 patterns, gap-closure layers, benchmark matrix).

## License

MIT.
