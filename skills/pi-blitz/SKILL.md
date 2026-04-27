---
name: pi-blitz
description: Symbol-anchored AST edits through the blitz Zig CLI (alpha 0.1.0-alpha.0). Effective for large preserved bodies and structural symbolic edits; not a universal replacement for core edit. Tiny or one-line edits often favor core edit. No prebuilt binaries yet — requires blitz built from source and configured via ~/.pi/pi-blitz.json. MCP alternative available at codewithkenzo/blitz.
---

# pi-blitz

## Current status

Alpha — version 0.1.0-alpha.0. Requires blitz CLI 0.1.0-alpha.0 built from source ([codewithkenzo/blitz](https://github.com/codewithkenzo/blitz)). No prebuilt binaries published yet. Configure the binary path via `~/.pi/pi-blitz.json`.

Authenticated Pi/model benchmarks show large reductions in provider output tokens, tool-call argument tokens, wall time, and cost on handled symbol edits. Benchmark 2 efficiency claims compare a correct blitz result against a failed core attempt — not two correct results. Use with undo/review discipline.

Blitz is not a universal replacement for core `edit`. See "When NOT to use" below.

## When to use

Use when:

- Target edit is AST-scoped: a function, method, class, variable.
- You can describe the edit as "replace the body of `X`" or "insert this right after `X`".
- You want a smaller output token footprint and can review/undo the result.

## When NOT to use

- Full-file rewrites — use core `write` / `edit`.
- Text-`oldText/newText` edits that aren't symbol-scoped — use `pi-mono-multi-edit`.
- Quick one-line changes where reading + edit is faster than symbol resolution.
- Files whose language is not yet supported by blitz (check `pi_blitz_doctor`).

## Tools

| Tool | Purpose |
|---|---|
| `pi_blitz_read` | AST structure summary of a file (imports + L-range definitions). |
| `pi_blitz_edit` | Single symbol-anchored edit. Exactly one of `after`/`replace`. |
| `pi_blitz_apply` | Structured v0.2 edit using JSON IR. Choose operation + target + edit object. |
| `pi_blitz_replace_body_span` | Narrow low-token wrapper for exact in-body replacement. |
| `pi_blitz_insert_body_span` | Narrow low-token wrapper for body-anchor insertion. |
| `pi_blitz_wrap_body` | Narrow low-token wrapper for wrapping a large body without repeating it. |
| `pi_blitz_compose_body` | Narrow low-token wrapper for preserve-island / multi-hunk body composition. |
| `pi_blitz_multi_body` | Narrow low-token wrapper for multiple body-scoped edits in one atomic apply. |
| `pi_blitz_patch` | Compact tuple patch wrapper for replace/insert_after/wrap/replace_return/try_catch. |
| `pi_blitz_try_catch` | Narrow semantic wrapper for wrapping a symbol body in try/catch. |
| `pi_blitz_replace_return` | Narrow semantic wrapper for replacing a return expression. |
| `pi_blitz_batch` | Multiple symbol-anchored edits in one file. |
| `pi_blitz_rename` | AST-verified rename in one file (skips strings/comments). |
| `pi_blitz_undo` | Revert the last blitz edit on a file. Requires `confirm: true`. |
| `pi_blitz_doctor` | Report version, grammars, cache health. |

## pi_blitz_apply operation selection

Prefer the narrow tools when possible. Use `pi_blitz_apply` only when the narrow tool does not fit or you need the full JSON IR.

Use structured operations when edit shape is deterministic:

- `replace_body_span`:
  - Exact anchor edit inside a symbol body.
  - Provide `edit.find`, `edit.replace`, optional `edit.occurrence`.
- `insert_body_span`:
  - Add snippet before/after a body anchor inside symbol.
  - Provide `edit.anchor`, `edit.position`, `edit.text`.
- `wrap_body`:
  - Add pre/post wrapper around existing body.
  - `edit.before`, `edit.keep: "body"`, `edit.after` required.
- `compose_body`:
  - Keep multiple chunks while preserving inner sections.
  - `edit.segments` must be ordered array of `{text}`, `{keep:"body"}`, or `{keep:{...}}`.
- `insert_after_symbol`:
  - Append code directly after target declaration.
  - Provide `edit.code`.
- `set_body`:
  - Replace complete symbol body at once.
  - Provide `edit.body`, optional `edit.indentation`.
- `patch`:
  - Use tuple ops for targeted symbol patches.
  - Provide `edit.ops` as `[op, symbol, ...]` tuples only.

Target object:

- `target.symbol` required symbol name only.
- `target.kind` optional (`function`, `method`, `class`, `variable`, `type`).
- `target.range` optional (`body` default, or `node`).

Avoid free-form snippets for these operations; keep operation payload minimal and explicit.

## Snippet grammar

Three ways to preserve unchanged body when you don't want to rewrite the whole symbol:

1. **`// ... existing code ...`** (and language-matching `#`/`/* */` variants) — fastedit-compatible lazy marker.
2. **`// @keep`** — strict marker, recommended for unambiguous edits.
3. **`// @keep lines=N`** — numeric anchor, least ambiguous.

If you do not use a marker, the snippet is treated as a **full replacement** of the target symbol body. Marker behavior has local golden-output coverage but still needs broader benchmark coverage.

## Examples

### Wrap a function in try/catch

```ts
pi_blitz_edit({
  file: "src/app.ts",
  replace: "handleRequest",
  snippet: `  try {
    // @keep
  } catch (e) {
    logger.error(e);
    throw e;
  }`,
});
```

For `replace`, pass only the symbol name in `replace`; the `snippet` is the replacement body. Do not repeat the function signature unless you already have it handy — blitz preserves it automatically. For large unchanged bodies, use `// ... existing code ...` or `// @keep`; never repeat unchanged code.

### Narrow structured examples

### Replace one tail span

```ts
pi_blitz_replace_body_span({
  file: "src/logic.ts",
  symbol: "computeTotal",
  find: "return subtotal;",
  replace: "return subtotal + fee;",
  occurrence: "last",
});
```

### Wrap with retry block

```ts
pi_blitz_wrap_body({
  file: "src/logic.ts",
  symbol: "handleRequest",
  before: "\n  try {",
  after: "  } catch (error) {\n    logger.error(error);\n    throw error;\n  }\n",
  indentKeptBodyBy: 2,
});
```

### Compose preserved islands

```ts
pi_blitz_compose_body({
  file: "src/logic.ts",
  symbol: "computeTotal",
  segments: [
    { keep: { afterKeep: "  let total = seed;", includeAfter: true, occurrence: "only" } },
    { text: "\n  if (!Number.isFinite(total)) throw new RangeError();\n" },
    { keep: { beforeKeep: "  return total;", includeBefore: true, occurrence: "last" } },
  ],
});
```

### Multi-body atomic edit

```ts
pi_blitz_multi_body({
  file: "src/logic.ts",
  edits: [
    { symbol: "loadUser", op: "replace_body_span", find: "return null;", replace: "return user;", occurrence: "only" },
    { symbol: "saveUser", op: "insert_body_span", anchor: "await db.save(user);", position: "after", text: "\n  await audit(user.id);", occurrence: "only" },
    { symbol: "handleRequest", op: "wrap_body", before: "\n  try {", after: "  } catch (error) {\n    logger.error(error);\n    throw error;\n  }\n", indentKeptBodyBy: 2 },
  ],
});
```

### Apply JSON examples

### Replace one tail span

```ts
pi_blitz_apply({
	file: "src/logic.ts",
	operation: "replace_body_span",
	target: { symbol: "computeTotal" },
	edit: {
		find: "return subtotal;",
		replace: "return subtotal + fee;",
		occurrence: "last",
	},
});
```

### Wrap with retry block

```ts
pi_blitz_apply({
	file: "src/logic.ts",
	target: { symbol: "handleRequest", kind: "function" },
	operation: "wrap_body",
	edit: {
		before: "try {\n",
		keep: "body",
		after: "} catch (error) {\n  logger.error(error);\n  throw error;\n}",
		indentKeptBodyBy: 2,
	},
});
```

### Insert helper after symbol

```ts
pi_blitz_apply({
	file: "src/logic.ts",
	target: { symbol: "handleRequest", kind: "function" },
	operation: "insert_after_symbol",
	edit: {
		code: "function logRequest(req: unknown) { console.log(req); }",
	},
});
```

### Insert a helper after a symbol

```ts
pi_blitz_edit({
  file: "src/app.ts",
  after: "handleRequest",
  snippet: `function healthCheck() {
  return { ok: true };
}`,
});
```

### Rename across a file

```ts
pi_blitz_rename({
  file: "src/app.ts",
  old_name: "oldName",
  new_name: "newName",
});
```

## Error handling

- `isError: true` with `details.reason = "no-undo-history"` — no previous edit to revert.
- `isError: true` with `details.reason = "no-occurrences"` — rename/edit target not found.
- `details.warning = "partial-edit"` — write succeeded but some chunks rejected; run `pi_blitz_diff` (v0.2) to review.
- Hard throws (shown in Pi as tool errors): binary missing, timeout, path escapes cwd, invalid params.

## Fallback to core `edit`

When blitz emits `{ "status": "needs_host_merge", ... }` as a single-line JSON payload, the target change can't be applied deterministically. Use the payload fields (`byteStart`, `byteEnd`, `excerpt`) to call core `edit` with a minimal context window — do not repeat the whole file.
