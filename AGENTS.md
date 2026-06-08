# AGENTS.md — pi-blitz

Cross-agent context for `@codewithkenzo/pi-blitz`, the Pi extension wrapper around the Blitz Zig CLI.

## Purpose

This repo registers Pi-facing Blitz tools, ships resident skill text, selects model-visible tool profiles, and bridges Pi tool calls to the `@codewithkenzo/blitz` binary/package.

## Stack

- Runtime/package manager: Bun
- Language: TypeScript strict
- Schema: TypeBox
- Effects/runtime glue: Effect v4 beta
- Package: Pi extension, built to `dist/index.js`

## Skills to load

- `kenzo-bun` — Bun scripts/build/test patterns.
- `kenzo-effect-ts` — Effect v4 integration patterns when touching runtime logic.
- `kenzo-pi-extensions` — Pi extension/tool registration behavior.
- `/home/kenzo/dev/blitz/.pi/skills/blitz-benchmarking` — required before benchmark integration, token accounting, resident skill changes, or token-savings claims.

## Blitz 0.4 token-core rules

- Resident tool schema and resident skill text are part of token cost.
- Do not claim token savings without real Pi artifacts, correctness status, tokenizer metadata, and Tokscale/provider accounting from the Blitz benchmark harness.
- `PI_BLITZ_TOOL_PROFILE=minimal|semantic|structural|admin|full` must actually control which schemas register; unused profile schemas must not be visible.
- Keep default model-visible output compact: operation/route, file, changed range/status, validation, and concise errors.
- Prefer stable, compact surfaces and lazy/discoverable docs over adding many always-visible tools.

## Key files

- `index.ts` — extension entrypoint.
- `src/tools.ts` — Pi tool registration and schemas.
- `src/blitz.ts` — Blitz subprocess bridge.
- `shared/` — shared helpers/types.
- `skills/pi-blitz/SKILL.md` — resident skill text packaged with the extension.
- `test/` — Bun tests.

## Commands

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Scope boundaries

Allowed for Blitz 0.4 profile/accounting work:
- tool registration/profile code;
- schema serialization/debug dump utilities;
- resident skill text only when measured or required for profile behavior;
- package tests and benchmark integration support.

Forbidden during this slice:
- unrelated Pi UI behavior;
- unrelated MCP behavior;
- broad refactors;
- unmeasured skill rewrites;
- publishing/version bumps unless explicitly requested.

## Git / verification

- Work on `feat/blitz-0.4-token-core-profile` for the 0.4 first-slice branch.
- Run `bun run typecheck`, `bun test`, and `bun run build` before claiming implementation done unless environment blocks them; record exact failures.
- Final handoff must state install/source path used by Blitz benchmark reports: local source, linked package, `npm install -g .`, or published package.
