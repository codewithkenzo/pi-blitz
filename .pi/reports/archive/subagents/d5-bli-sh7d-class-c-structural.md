# d5 bli-sh7d Class C structural implementation

## Summary
Implemented strict default/minimal `blitz_edit` Class C slice:
- `['rb', file, 'function', name, body]` for TS/JS unique function body replacement.
- `['ia', file, 'function', name, text]` for TS/JS insertion after unique function declaration.
- Unsupported structural aliases/languages still fail closed with no mutation.
- No core/apply_patch fallback; route stays `blitz_edit`/Blitz CLI compact apply.

## Changed files

pi-blitz:
- `index.ts` — honor `BLITZ_BIN` override before bundled package binary.
- `src/tools.ts` — allow only TS/JS rb/ia function tuples in minimal `blitz_edit`; keep unsupported structural aliases declined.
- `src/language-capabilities.ts` — mark JS structural support for tested function declarations.
- `test/tool-profiles.test.ts` — add Class C success/fail-closed coverage and preserve token guard.

blitz:
- `src/tree_sitter/bindings.zig` — map `.js` to TypeScript tree-sitter grammar.
- `src/grammar_config.zig` — include `.js` in TypeScript grammar config.
- `.tickets/bli-sh7d.md` — lifecycle notes/closure.

## Verification

Passed:
- `/home/kenzo/dev/blitz`: `zig build && zig build test`
- `/home/kenzo/dev/blitz`: focused JS compact rb CLI smoke with `zig-out/bin/blitz apply --edit - --json`
- `/home/kenzo/dev/pi-blitz`: `bun run typecheck && bun test && bun run build`

Focused row:
- Broad/final Class C row not run; parent instructed to rerun `bli-o1pd` after close. No `bli-o1pd` or `bli-qgz1` started here.

## Residual risks

- JS support uses TypeScript tree-sitter grammar mapping, intentionally limited by tests to function declarations for this slice.
