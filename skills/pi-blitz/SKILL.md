---
name: pi-blitz
description: Tiny Blitz edit surface. Use `blitz_edit` when exposed.
---

# pi-blitz

Default tool: `blitz_edit`.

```ts
blitz_edit({ e: [["x", "src/a.ts", "old", "new"]] })
blitz_edit({ f: "src/a.ts", e: [["x", "old", "new"]] })
```

Rules:
- `x` exact old/new; fail closed on no/multi-match.
- Minimal: exact/simple/config/doc/multi via `x` only.
- Structural `rb` declines; needs future structural profile.
- On `ok c=N ...` or `noop ...`, stop.
- Unsupported/ambiguous: no edit; no hidden fallback.
- Token claims need Pi JSONL + Tokscale match.
