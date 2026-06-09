---
name: pi-blitz
description: Tiny Blitz AST edit routing. Use when symbol/body edit likely beats core. Else core/apply_patch. Savings require correct Tokscale proof.
---

# pi-blitz

Not core replacement by default. Choose cheapest route.

Core/apply_patch if edit is tiny text, whole-file, unsupported, unclear symbol, or exact old/new is shorter than Blitz args.

Blitz if target is symbol/body, large body stays unchanged, multi-op structural edit avoids replay, or benchmark says Blitz wins.

Count savings only for correct Tokscale-matched rows where chosen route is cheaper. Failed rows are caveats only.

`pi_blitz_route_edit` is runtime boundary, not core wrapper. It never calls core/apply_patch; core/apply_patch selections return terminal no-write declines (`status=declined`, `terminal=true`, `actionRequired=use_external_core_or_apply_patch`).

## Profiles

`PI_BLITZ_TOOL_PROFILE`:
- `minimal`: compact `pi_blitz_op` only (`minimal-v0`)
- `router`: `pi_blitz_route_edit`; executes Blitz only when supported and requested/proven cheaper, otherwise no-write decline to core/apply_patch
- `semantic`: patch, try_catch, replace_return
- `structural`: replace_body_span, multi_body, patch
- `admin`: read, rename, undo, doctor
- `full`: all/debug

## Tools

Use narrowest visible tool:
- route boundary → `pi_blitz_route_edit`; details expose `contextSavingsPct`, `schemaTokensExpected`, `argTokensExpected`, `outputTokensExpected`, `fallbackContextTokensExpected`, `selectedBecause`
- span replace → `pi_blitz_replace_body_span`
- many body edits → `pi_blitz_multi_body`
- mixed tuple route → `pi_blitz_patch`
- try/catch → `pi_blitz_try_catch` or patch `try_catch`
- return edit → `pi_blitz_replace_return` or patch `replace_return`

Patch ops:
- `["replace_body_span", symbol, find, replace, occurrence?]`
- `["insert_body_span", symbol, anchor, position, text, occurrence?]`
- `["wrap_body", symbol, before, after, indent?]`
- `["replace_return", symbol, replace, occurrence?]`
- `["try_catch", symbol, catchBody?]`

Keep path exact. Never repeat unchanged code. Undo needs `confirm:true`.

```ts
pi_blitz_replace_body_span({ file:"src/a.ts", symbol:"total", find:"return n;", replace:"return n+1;", occurrence:"last" })
pi_blitz_patch({ file:"src/a.ts", ops:[["replace_return","label",'return "unknown";',"last"]] })
```
