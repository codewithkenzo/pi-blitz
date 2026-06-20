---
name: pi-blitz
description: Tiny Blitz edit surface. Use `blitz_edit` when exposed.
---

# pi-blitz

Default: `blitz_edit` only.

```ts
blitz_edit({ e: [["x", "src/a.ts", "old", "new"]] })
blitz_edit({ f: "src/a.ts", e: [["x", "old", "new"], ["rb", "src/a.ts", "function", "name", "\n  return next;\n"], ["ia", "src/a.ts", "function", "name", "\nfunction next() {}\n"]] })
```

Rules:
- `x`: exact old/new; fail closed on no/multi-match.
- TS/JS: `rb` unique function body; `ia` after unique function declaration.
- On `ok c=N ...` or `noop ...`, stop.
- Unsupported/ambiguous ops decline with `no_mutation=true`; no hidden core/apply_patch fallback.
- Token claims need real Pi JSONL + Tokscale token match.
