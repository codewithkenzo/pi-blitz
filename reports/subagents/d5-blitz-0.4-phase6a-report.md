# D5 Blitz 0.4 Phase 6A report

Date: 2026-06-09
Status: implemented runtime token-first edit facade/router boundary in `@codewithkenzo/pi-blitz`.

## Runtime facade

New tool: `pi_blitz_route_edit`.

Profile: `PI_BLITZ_TOOL_PROFILE=router` registers only `pi_blitz_route_edit`. `minimal` remains unchanged as `minimal-v0` with only `pi_blitz_op`, so prior minimal profile benchmark surface is not silently bloated.

Full profile now includes router facade plus existing tools.

## Operation syntax

Supported params:

```json
{
  "f": "src/app.ts",
  "r": "auto",
  "s": "rr\tformatStatus\tstatus.toUpperCase()\tonly",
  "fallbackContextTokensExpected": 500,
  "p": true,
  "d": false
}
```

- `f`: file path.
- `ops`: existing compact tuple array, same aliases as `pi_blitz_op`.
- `s`: compact tab-line script, same parser as `pi_blitz_op`.
- `r`: optional route preference: `auto`, `blitz`, `core`, `apply_patch`.
- `fallbackContextTokensExpected`: caller/harness estimate for core/apply_patch context tokens.
- `p`: dry run when Blitz selected.
- `d`: include compact diff when Blitz selected.

## Route decisions

The router returns one selected route:

- `selected: "blitz"`: executes existing `pi_blitz_op` translation then existing Blitz apply path.
- `selected: "core"`: no-write decline; pi-blitz does not call core internally.
- `selected: "apply_patch"`: no-write decline; pi-blitz does not call apply_patch internally.

Fail-closed behavior:

- missing `ops`/`s` => decline to `apply_patch`.
- malformed Blitz tuple/script => decline to `apply_patch` with tuple error.
- `auto` without `fallbackContextTokensExpected` => decline to `apply_patch`.
- `auto` when estimated Blitz context is not cheaper => decline to `apply_patch`.
- explicit `core`/`apply_patch` => decline, never mutates.
- explicit `blitz` + valid payload => executes Blitz, but docs say this is not token-savings proof.

## Token-first fields

Every route result details include Phase 6 fields:

- `contextSavingsPct`
- `schemaTokensExpected`
- `argTokensExpected`
- `outputTokensExpected`
- `fallbackContextTokensExpected`
- `selectedBecause`

Also includes:

- `selected`
- `profile: "router"`
- `tool`

These are runtime estimates only. No token savings claim without real Pi/Tokscale accepted rows.

## Tests added/updated

- `test/tool-profiles.test.ts`
  - router profile registers only `pi_blitz_route_edit`.
  - full profile includes router facade and expected count.
- `test/smoke.test.ts`
  - route schema accepts token-first fields.
  - auto route without fallback proof declines with token fields.
  - requested core route declines without mutating.

## Verification

Passed in `/home/kenzo/dev/pi-blitz`:

```bash
bun run typecheck
bun test
bun run build
```

## Limitations

- Router does not call/emulate Pi core edit or OpenAI apply_patch internally; fallback selections are explicit no-write declines.
- Runtime token fields are estimates, not Tokscale proof.
- Auto route needs caller-supplied fallback estimate; no live core/apply_patch token oracle exists.
- No Blitz source mutated. Report written in pi-blitz repo to avoid Phase 5A fixer conflict in Blitz repo.
