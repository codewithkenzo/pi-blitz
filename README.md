# pi-blitz

Fast, token-efficient code edits for Pi.

On a 10k-token function try/catch wrap benchmark, Pi Blitz used 85 provider output tokens instead of 9,640 and finished in 4.6s instead of 61s.

`pi-blitz` is a Pi Rig extension that gives Pi a set of low-token edit tools powered by the [`blitz`](https://github.com/codewithkenzo/blitz) CLI. It is built for the moments when a coding agent needs to change a large function but should not waste time and tokens printing the whole function back.

## Why use it

Normal agent edits can get expensive fast: the model reads a big body, rewrites most of it unchanged, then sends that whole replacement through a tool call. Blitz changes that pattern.

### Current benchmark snapshot

`gpt-5.4-mini`, live Pi tool calls, N=1 full matrix plus prior N=5 checks on strong classes:

| Edit class | Core edit | pi-blitz | Result |
|---|---:|---:|---|
| 10k-token function try/catch wrap | 9,640 output tokens / 61s | 85 output tokens / 4.6s | 99.1% fewer output tokens |
| Large structural patch, 3 edits | 9,708 output tokens / failed output | 107 output tokens / correct | 98.9% fewer output tokens vs failed core attempt |
| Async try/catch wrapper | 149 arg tokens | 42 arg tokens | 71.8% fewer tool-call arg tokens |
| Class method try/catch wrapper | 118 arg tokens | 40 arg tokens | 66.1% fewer tool-call arg tokens |
| TSX return replacement | 67 arg tokens | 48 arg tokens | 28.4% fewer tool-call arg tokens |

The big wins are large preserved bodies. Small exact edits should still use Pi core tools.

With `pi-blitz`, Pi can send a compact operation instead:

- “wrap `fetchUser` in try/catch”
- “replace the last return in `computeTotal`”
- “insert this line after `const normalized = ...`”
- “rename this identifier in code, but not in strings/comments”

Blitz handles the file lookup, code location, indentation, parse check, backup, and write.

On a larger three-edit structural patch, Blitz used 107 output tokens where a core edit attempt used 9,708 and failed the expected output. For smaller semantic edits, the savings are smaller but still useful: try/catch wrappers cut tool-call arguments by 66–72%, and return-expression rewrites cut them by 22–28% in the current Pi bench.

That is the point: fewer wasted tokens, faster edits, less agent thrash.

## When it helps

Use `pi-blitz` when the edit is larger than a one-liner but smaller than a full rewrite:

| Good fit | Better with core edit/write |
|---|---|
| Wrap a large function body | New files |
| Change a return expression | Tiny one-line changes |
| Insert code near a known statement | Whole-file rewrites |
| Several related edits in one file | Unsupported languages |
| Rename an identifier safely | Exact oldText/newText patches |

Core `edit` is still better for small direct changes. `pi-blitz` is for speed and token efficiency on larger structured edits.

## Install

Install from npm:

```bash
pi install npm:@codewithkenzo/pi-blitz
```

`pi-blitz` depends on `@codewithkenzo/blitz`, which installs the matching native CLI package when available.

From source:

```bash
pi install /path/to/pi-blitz
```

If you build Blitz yourself or want a custom binary, point Pi at it:

```json
// ~/.pi/pi-blitz.json
{ "binary": "/abs/path/to/blitz/zig-out/bin/blitz" }
```

Verify in Pi:

```text
/help
```

You should see `pi_blitz_*` tools.

## Tools

| Tool | Use for |
|---|---|
| `pi_blitz_read` | Inspect a file before editing. |
| `pi_blitz_wrap_body` | Wrap a large body without repeating it. |
| `pi_blitz_try_catch` | Add try/catch around a symbol body. |
| `pi_blitz_replace_return` | Replace a return expression. |
| `pi_blitz_replace_body_span` | Replace a known span inside a body. |
| `pi_blitz_insert_body_span` | Insert text before/after a known body anchor. |
| `pi_blitz_patch` | Compact tuple edits: replace, insert, wrap, return, try/catch. |
| `pi_blitz_multi_body` | Multiple body edits in one file. |
| `pi_blitz_compose_body` | Preserve parts of a body while changing the rest. |
| `pi_blitz_edit` | Symbol-anchored replacement/insertion. |
| `pi_blitz_batch` | Batch several symbol edits. |
| `pi_blitz_apply` | Full structured JSON edit API. |
| `pi_blitz_rename` | Rename identifiers while skipping strings/comments. |
| `pi_blitz_undo` | Undo the last Blitz edit for a file. |
| `pi_blitz_doctor` | Check Blitz binary, grammars, and cache. |

## Examples

### Add try/catch without repeating a huge body

Use:

```text
pi_blitz_try_catch
file: src/api/users.ts
symbol: fetchUser
catchBody: console.error(error); throw error;
```

Pi sends a small tool call. Blitz keeps the existing function body and wraps it.

### Replace a return expression

Use:

```text
pi_blitz_replace_return
file: src/pricing.ts
symbol: computeTotal
expr: subtotal + tax
occurrence: last
```

### Rename code safely

Use:

```text
pi_blitz_rename
file: src/utils.ts
old_name: processData
new_name: transformPayload
```

Strings and comments are skipped.

## MCP alternative

If you want the same Blitz tools outside Pi, use the MCP server included in [`codewithkenzo/blitz`](https://github.com/codewithkenzo/blitz):

```bash
BLITZ_BIN=/abs/path/to/blitz/zig-out/bin/blitz \
BLITZ_WORKSPACE=/abs/path/to/project \
bun /abs/path/to/blitz/mcp/blitz-mcp.ts
```

## Configuration

`~/.pi/pi-blitz.json`:

```ts
type Config = {
  binary?: string; // absolute path or command name on PATH
};
```

The binary path is user-level config. Project config cannot override it.

## Supported languages

Blitz currently supports:

- TypeScript
- TSX
- Python
- Rust
- Go

Run `pi_blitz_doctor` to confirm your local binary and grammar support.

## License

MIT
