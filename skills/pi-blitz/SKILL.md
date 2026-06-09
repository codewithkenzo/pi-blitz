---
name: pi-blitz
description: Compact Blitz AST edit profile. Use for symbol/body edits likely cheaper than core. Tiny/plain text edits often favor core/apply_patch. Never claim savings without benchmark proof.
---

# pi-blitz compact resident skill

Blitz is not universal core-edit replacement. Choose cheapest safe route.

## Route rule

Use core/apply_patch when:
- tiny one-line/plain text edit
- unsupported language/path
- whole-file rewrite
- exact oldText/newText is shorter than Blitz args
- unsure symbol target

Use Blitz when:
- edit targets symbol/function/method/body
- large unchanged body can be preserved
- structural multi-op/try-catch/return edit avoids repeating code
- benchmark/profile evidence says Blitz wins

Savings count only when row correct, token-accounted, Tokscale-matched, and route chosen by measured proof. Failed/caveated rows count as evidence, not savings.

## Profiles

`PI_BLITZ_TOOL_PROFILE` controls visible schemas:
- `minimal`: `pi_blitz_patch` only (`minimal-v0` label)
- `semantic`: `pi_blitz_patch`, `pi_blitz_try_catch`, `pi_blitz_replace_return`
- `structural`: `pi_blitz_replace_body_span`, `pi_blitz_multi_body`, `pi_blitz_patch`
- `admin`: read/rename/undo/doctor
- `full`: all tools for debug/backcompat

## Tool choice

Prefer narrowest visible tool:
- tail/span replace → `pi_blitz_replace_body_span`
- multiple body edits → `pi_blitz_multi_body`
- tuple ops / compact mixed structural route → `pi_blitz_patch`
- wrap function/method body → `pi_blitz_try_catch` or patch `try_catch`
- replace specific return expression → `pi_blitz_replace_return` or patch `replace_return`
- inspect/undo/debug → admin/full only

## Compact patch tuple forms

Use `pi_blitz_patch` with shortest valid tuple ops:
- `["replace_body_span", symbol, find, replace, occurrence?]`
- `["insert_body_span", symbol, anchor, position, text, occurrence?]`
- `["wrap_body", symbol, before, after, indentKeptBodyBy?]`
- `["replace_return", symbol, replace, occurrence?]`
- `["try_catch", symbol, catchBody?]`

Keep `file` path exact. Do not repeat unchanged code.

## Examples

Replace tail return:
```ts
pi_blitz_replace_body_span({ file: "src/a.ts", symbol: "total", find: "return n;", replace: "return n + 1;", occurrence: "last" })
```

Multi edit:
```ts
pi_blitz_multi_body({ file: "src/a.ts", edits: [
  { symbol: "a", op: "replace_body_span", find: "return x;", replace: "return x + 1;", occurrence: "last" },
  { symbol: "b", op: "insert_body_span", anchor: "const y = x;", position: "after", text: "\n  audit(y);", occurrence: "only" },
] })
```

Patch tuple:
```ts
pi_blitz_patch({ file: "src/a.ts", ops: [["replace_return", "label", 'return "unknown";', "last"]] })
```

## Safety

- Review changed diff after use when possible.
- Use `pi_blitz_undo` only with `confirm: true`.
- Do not use Blitz for binary files, unsupported grammars, or broad rewrites.
- If Blitz loses measured tokens on simple both-correct row, choose core/apply_patch and report why.
