---
name: pi-blitz
description: Tiny Blitz edit surface. Use `blitz_edit` when exposed.
---

# pi-blitz

Default profile: `blitz_edit` only.

```ts
blitz_edit({ e: [["x", "src/a.ts", "old", "new"]] })
blitz_edit({ f: "src/a.ts", e: [["x", "old", "new"], ["rb", "src/a.ts", "function", "name", "\n  return next;\n"], ["ia", "src/a.ts", "function", "name", "\nfunction next() {}\n"]] })
```

Rules:
- `x` exact old/new replace; fails closed on no/multi-match.
- TS/JS only: `rb` replaces unique function body; `ia` inserts after unique function declaration.
- Success output: `ok c=N ...` or `noop ...`; then stop.
- Unsupported/ambiguous ops decline with `no_mutation=true`; no hidden core/apply_patch fallback.
- Token claims require real Pi JSONL + Tokscale token-match evidence.
