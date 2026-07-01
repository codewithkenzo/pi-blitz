# D5 pi-blitz profile review fixes

## Summary

Implemented reviewer-required profile fixes on `feat/blitz-0.4-token-core-profile`.

## Changed behavior

- Missing or empty `PI_BLITZ_TOOL_PROFILE` now resolves to `minimal`.
- Explicit `PI_BLITZ_TOOL_PROFILE=full` still resolves/registers full 15-tool surface.
- `scripts/dump-tool-specs.ts` default profile now matches runtime default (`minimal`).

## Files changed

- `src/tool-profiles.ts`
- `scripts/dump-tool-specs.ts`
- `test/tool-profiles.test.ts`
- `.pi/reports/subagents/d5-pi-blitz-profile-review-fixes.md`

## Tests added/updated

- Covered required profiles: `minimal`, `semantic`, `structural`, `admin`, `full`.
- Added default resolver test for `undefined` and empty string.
- Added fake `ExtensionAPI` registration tests:
  - default env registers only `pi_blitz_patch`
  - explicit `full` registers 15 tools

## Verification

- `bun run typecheck` — passed
- `bun test` — passed
- `bun run build` — passed
- `bun scripts/dump-tool-specs.ts --profile all` + `--profile minimal` — passed sanity check
  - profile counts: minimal 1, semantic 3, structural 6, admin 4, full 15
  - minimal dump: `minimal-v0`, tools: `pi_blitz_patch`

## Residual risks

None found.
