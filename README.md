# pi-blitz

Symbol-anchored code editing via AST. Part of the Pi Rig plugin suite.

## What it does

`pi-blitz` wraps the [`blitz`](https://github.com/codewithkenzo/blitz) CLI — a semantic editor that understands code structure (imports, function bodies, expressions) and edits via symbol anchors instead of line numbers or text search.

Rather than rewriting entire files, blitz targets specific functions, classes, or expressions and applies surgical edits (replace body, wrap, insert, patch). This approach reduces model output tokens significantly and handles large structural changes that text-based editors struggle with.

## Why use it

**Large codebase edits:** Blitz excels when:
- Editing function bodies while preserving signature
- Wrapping expressions or statements
- Multi-site structural changes within one file
- Refactoring with preservation of surrounding code

**Token efficiency:** Output is compact. `wrap_body` on a 10k-token function may produce ~100 tokens of instructions instead of ~10k tokens of replacement text.

**Semantic safety:** Operates on AST, not text. Renames skip strings and comments. Edits are symbol-scoped, not regex-prone.

**Core `edit` vs. blitz:** Core `edit` is better for small changes (one-liners, whole-file rewrites, new files). Blitz targets the middle ground — large bodies, structural precision, multi-edit batches.

## Install

Requires the `blitz` CLI built from source at [codewithkenzo/blitz](https://github.com/codewithkenzo/blitz).

1. **Build blitz:**
   ```bash
   git clone https://github.com/codewithkenzo/blitz
   cd blitz
   zig build -Doptimize=ReleaseFast
   ```

2. **Point pi-blitz at your binary:**
   ```json
   // ~/.pi/pi-blitz.json
   { "binary": "/abs/path/to/blitz/zig-out/bin/blitz" }
   ```

3. **Install the extension:**
   ```bash
   pi install /path/to/pi-plugins-repo-kenzo/extensions/pi-blitz
   ```

4. **Verify:**
   ```
   /help
   ```
   Should list 15 `pi_blitz_*` tools.

## Tools overview

| Tool | Use for |
|---|---|
| `pi_blitz_read` | Inspect file structure — imports, functions, declarations with line ranges. |
| `pi_blitz_edit` | Single symbol edit: replace body or insert after/before anchor. |
| `pi_blitz_batch` | Multiple edits to one file in one call. |
| `pi_blitz_apply` | Structured JSON-based edit with operation type. |
| `pi_blitz_wrap_body` | Wrap function/expression body (e.g., add try-catch, wrap in async). |
| `pi_blitz_replace_body_span` | Replace a specific span inside a body. |
| `pi_blitz_insert_body_span` | Insert text at position inside a body. |
| `pi_blitz_compose_body` | Preserve islands of code while rewriting the rest. |
| `pi_blitz_multi_body` | Atomic multi-body edits. |
| `pi_blitz_patch` | Compact tuple operations: `replace`, `insert_after`, `wrap`, `replace_return`, `try_catch`. |
| `pi_blitz_try_catch` | Semantic shorthand for wrapping in try-catch. |
| `pi_blitz_replace_return` | Semantic shorthand for return statement rewrite. |
| `pi_blitz_rename` | AST-verified rename (skips strings, comments). |
| `pi_blitz_undo` | Revert last edit. Requires `confirm: true`. |
| `pi_blitz_doctor` | Check version, supported grammars, cache. |

## Examples

### Wrap a function in try-catch

```
tool: pi_blitz_wrap_body
file: src/api/users.ts
symbol: fetchUser
operation: try_catch
```

Blitz wraps the entire body of `fetchUser` in try-catch without repeating it.

### Batch edits

```
tool: pi_blitz_batch
file: src/db/schema.ts
edits:
  - symbol: User
    operation: replace_body
    payload: "..."
  - symbol: Post
    operation: wrap_body
    payload: "..."
```

### Rename across file

```
tool: pi_blitz_rename
file: src/utils.ts
old: processData
new: transformPayload
```

Renames `processData` function. Skips matching strings and comments.

## When to use / when not to use

**Use blitz for:**
- Function body refactors (preserve signature, rewrite logic)
- Structural wrapping (try-catch, async wrapper, conditional guard)
- Multi-edit batches within one file
- Large codebases where precision matters

**Avoid blitz for:**
- One-liner changes (core `edit` is simpler)
- New files (use core `edit`)
- Whole-file rewrites (core `edit` is more direct)
- Edits across multiple files (run multiple tools in sequence instead)

## Configuration

`~/.pi/pi-blitz.json` only:

```ts
type Config = {
  binary?: string; // path to blitz CLI, or command name on PATH
};
```

Cannot be overridden at project level.

## Architecture & More

Full docs, edit algorithm, grammar support, and design: [`codewithkenzo/blitz/docs/blitz.md`](https://github.com/codewithkenzo/blitz/blob/main/docs/blitz.md).

Implementation uses Effect v4 internally (errors, concurrency, resource cleanup). Runs on Zig 0.16+.

## License

MIT
