---
name: pi-blitz
description: Minimal Blitz AST edit routing. Use only when symbol/body edit likely cheaper than core; otherwise core/apply_patch. Savings require benchmark proof.
---

# pi-blitz

Not universal core replacement. Pick cheapest safe route.

## Route

Core/apply_patch if tiny text edit, whole-file rewrite, unsupported file, unclear symbol, or exact old/new is shorter than Blitz args.

Blitz if target is symbol/function/method body, unchanged body is large, multi-op structural edit avoids replay, or benchmark evidence says Blitz wins.

Count savings only for correct, Tokscale-matched rows where chosen route is cheaper. Failed/caveated rows are evidence only.

## Profiles

`PI_BLITZ_TOOL_PROFILE`:
- `minimal`: `pi_blitz_patch` (`minimal-v0`)
- `semantic`: patch + try_catch + replace_return
- `structural`: replace_body_span + multi_body + patch
- `admin`: read/rename/undo/doctor
- `full`: all tools for debug/backcompat

## Tool choice

Use narrowest visible tool:
- span/tail replace → `pi_blitz_replace_body_span`
- many body edits → `pi_blitz_multi_body`
- tuple/mixed route → `pi_blitz_patch`
- try/catch wrap → `pi_blitz_try_catch` or patch `try_catch`
- return edit → `pi_blitz_replace_return` or patch `replace_return`

Patch tuple ops:
- `["replace_body_span", symbol, find, replace, occurrence?]`
- `["insert_body_span", symbol, anchor, position, text, occurrence?]`
- `["wrap_body", symbol, before, after, indentKeptBodyBy?]`
- `["replace_return", symbol, replace, occurrence?]`
- `["try_catch", symbol, catchBody?]`

Keep file path exact. Do not repeat unchanged code. Review diff. Undo only with `confirm:true`.

Example:
```ts
pi_blitz_replace_body_span({ file: "src/a.ts", symbol: "total", find: "return n;", replace: "return n + 1;", occurrence: "last" })
pi_blitz_patch({ file: "src/a.ts", ops: [["replace_return", "label", 'return "unknown";', "last"]] })
```
