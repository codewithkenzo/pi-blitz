---
name: pi-blitz
description: Tiny Blitz edit surface. Use `blitz_edit` for exact edits when this profile is active; use other Blitz profiles only when explicitly exposed.
---

# pi-blitz

Default profile exposes `blitz_edit` only.

Use:

```ts
blitz_edit({ f: "src/a.ts", e: [["x", "old", "new"]] })
blitz_edit({ e: [["x", "src/a.ts", "old", "new"], ["x", "src/b.ts", "old", "new"]] })
```

Rules:
- `x` is exact old/new replace, Blitz-owned, fail-closed on no-match or multi-match.
- Successful quiet output is `ok c=N` or `noop`.
- Do not claim token savings without real Pi JSONL + Tokscale token-match evidence.
- If an edit route loses tokens, shrink schema/args/output or switch profile/IR; do not count hidden core fallback as Blitz success.
- Debug profiles may expose `pi_blitz_op`, route, structural, semantic, admin, or full tools.
