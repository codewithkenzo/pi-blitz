---
name: pi-blitz
description: Tiny Blitz edit surface. Use `blitz_edit` when exposed.
---

# pi-blitz

Default: `blitz_edit` only.

```ts
blitz_edit({ e: [["x", "src/a.ts", "old", "new"]] })
blitz_edit({ f: "src/a.ts", e: [["x", "old", "new"]] })
```

Rules:
- `x`: exact old/new; fail closed on no/multi-match.
- Minimal default: exact/simple/config/doc/tiny multi via `x`; structural `rb` declines. Use explicit structural profile later.
- On `ok c=N ...` or `noop ...`, stop.
- Unsupported/ambiguous ops decline with `no_mutation=true`; no hidden core/apply_patch fallback.
- Token claims need real Pi JSONL + Tokscale token match.
