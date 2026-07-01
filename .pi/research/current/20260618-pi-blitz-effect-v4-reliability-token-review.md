# Research: pi-blitz architecture review (Effect v4 + token reliability)

## Question
Provide concrete, implementation-ready guidance to improve reliability in pi-blitz while minimizing token usage, specifically covering:
- Effect error channels
- schemas/TypeBox boundaries
- layers/services
- concurrency locks
- scoped resources
- config
- logging/telemetry
- testing strategy

Tie recommendations to token-saving goals and keep decisions unambiguous (no retry/fallback ambiguity).

## Answer / Recommendation (high-level)
Current code is already close to a good v4 baseline: it uses typed errors, `Cause.findErrorOption`, explicit schema-driven boundaries, lock ordering to avoid deadlocks, scoped file snapshots, and deterministic route-no-write behavior when Blitz is not selected. The most valuable next improvements are **small and measurable**:

1. **Keep the API-compatibility boundary explicit** by migrating external dependencies (binary invocation, locks, config hash/cache knobs) behind `Context.Service` + `Layer` so tests and route tooling can inject bounded, observability-friendly versions without changing tool contracts.
2. **Tighten failure telemetry** while preserving compact tool output: return explicit, compact `details` + short `text`, with full error diagnostics in internal logs only.
3. **Lock and resource guarantees**: convert lock acquisition plus rollback snapshots into a single scoped acquisition/release helper and ensure abort/timeout cleanup paths are deterministic.
4. **Route/token budget honesty**: lock fallback logic to “no internal fallback” with measured rows; keep `selectedBecause` fields deterministic and avoid optimistic claims.
5. **Test around hidden failure planes**: cause-type extraction (`findErrorOption`/`findDefect`), cancellation and timeout paths, and schema evolution checks.

## Claim-audit with evidence

### Claim 1: pi-blitz already uses Effect v4-era error patterns in core boundaries.
- **Evidence (local):** `runTool` catches failures using `Effect.runPromiseExit(...)`, `Cause.findErrorOption`, and classifies only `BlitzSoftError` as recoverable tool errors; all other tagged failures are thrown upward as hard errors (`src/tool-runtime.ts:83-106`).
- **Evidence (remote):** Effect v4 docs list `runPromiseExit` as the exit-based runner and migration docs confirm `Cause.failureOption` -> `Cause.findErrorOption` + `catch` renames (`cause` docs and `migration/error-handling.md`, `migration/cause.md`).
- **Confidence:** High.

### Claim 2: Concurrency serialization and rollback are already guarded but can be hardened.
- **Evidence (local):** path locks use `acquireUseRelease` and sorted lock order for cross-file safety (`src/mutex.ts:20-53`, `src/tools.ts:2536-2540`, `test/smoke.test.ts:500-525`).
- **Evidence (remote):** Resource docs show `acquireUseRelease` acquires/uses/releases reliably even on error (`resource-management/introduction`).
- **Confidence:** High (implementation exists; hardening is refinement).

### Claim 3: Token-budget logic is implemented but currently heuristic and not telemetry-validated.
- **Evidence (local):** router route-decisions are estimate-based from payload byte estimates, with explicit no-claim branch and no internal core/apply_patch execution (`src/tools.ts:2285-2365`, `src/tools.ts:2628-2680`). Tests validate decline and selection reasons (`test/smoke.test.ts:110-130`, `test/smoke.test.ts:130-149`, `test/apply-runtime.test.ts:571+`).
- **Confidence:** High.

### Claim 4: Config loading currently uses TypeBox and silently drops invalid files.
- **Evidence (local):** `loadConfig` reads JSON from user/project paths, validates with TypeBox `Value.Check`, strips protected keys, and returns defaults if invalid/missing (`src/config.ts:17-38`, `src/config.ts:40-49`).
- **Confidence:** High; behavior is explicit.

## Findings

### 1) Error channels (reliability + clarity)
- Keep typed error hierarchy (`Data.TaggedError`) and avoid mixing broad `Error` catches outside explicit boundary. This already matches current direction (`src/errors.ts`, `src/tool-runtime.ts`).
- Add a **small soft-vs-hard classifier layer**:
  - classify `BlitzSoftError` + non-fatal parse JSON shape misses as soft;
  - classify subprocess spawn/timeout/system exceptions and malformed invariants as hard/fatal.
- In v4, `catch` + `catchCause` supersede v3 names; code already follows this (`src/tools.ts:1090-1105`, `tool-runtime` comment and docs). Continue using these consistently.
- Include short hard-failure `reason`/`tag` in `details` while keeping `text` compact (single short sentence), so token cost remains low.

### 2) Schemas / TypeBox boundaries
- Current boundaries are good: external-facing tool contracts are TypeBox schemas and internal payload shaping happens in domain translators (`src/tools.ts:27-265`, `src/tools.ts:213-257`, `src/tools.ts:2168-2231`).
- Improve boundary precision with:
  - `schemaVersion` optional internal-only field in schema docs (not public responses) to detect drift in routing/compat;
  - a single parser/validator module for tuple/schema translation so ambiguous schema paths share one mapping function.
- Keep strict `minItems/maxItems` and concise schema docs as they already reduce prompt tokens.

### 3) Layers / services
- v4 migration guidance expects service migration to `Context.Service` + explicit `Layer` composition (`migration/services.md`).
- pi-blitz can adopt this incrementally:
  - define `BlitzRuntimeServices` for: child process runner, file lock provider, config provider, spawn/env policy.
  - keep command execution deterministic and testable by injecting stubs in tests.
- Benefit: no API change, same outputs, lower latent fragility, clearer ownership for config/logging/metrics.

### 4) Concurrency locks
- Keep sorted lock ordering and per-file mutex map (good baseline, deadlock-safe) (`src/mutex.ts`, `src/tools.ts:2536-2538`).
- Add lock timing + contention metrics in internal `details` and internal logs only (e.g., queue wait time) to tune lock granularity without expanding user payloads.
- Add cancellation-safe lock cleanup test for `AbortSignal` to prove no lock leak under timeouts.

### 5) Scoped resources
- `snapshotFiles`/`restoreSnapshots` provide rollback behavior for multi-edit (`src/tools.ts:2415-2436`, `src/tools.ts:2440-2452`, `test/apply-runtime.test.ts:451-532`).
- Wrap snapshot + rollback sequence behind `acquireUseRelease` (or explicit scope helper) in one place to make semantics obvious and reduce accidental omission.
- This directly fits Effect resource guidance and improves confidence under thrown/aborted apply steps.

### 6) Config
- Keep the existing TypeBox user/project precedence model (`src/config.ts:17-38`) but return explicit diagnostics when project config is malformed (currently silently ignored).
- Add one “diagnostic details channel” used only in internal logs so operators can see invalid-file causes without polluting tool output.
- If moving to Effect `Config`, preserve file override precedence semantics explicitly (current behavior is not equivalent automatically).

### 7) Logging / telemetry
- Currently output relies on `console.warn` plus compact tool `details` (`index.ts`, `tool-runtime`, `tool-result` fields). That is token-cheap for caller-facing text.
- Add structured `Effect` logs on failure boundaries (`Effect.log`, `Effect.withLogSpan`, annotations) and keep logger layer replaceable.
- Use logging as an internal plane only; never print full spans/probe details in public tool output.
- Effect tracing can be added later for deep diagnostics using `Effect.withSpan` and optional OpenTelemetry layer, but gated behind env/provider config to avoid overhead for default path.

### 8) Testing strategy
- Current tests already cover profile routing, lock ordering, and rollback paths (`test/tool-profiles.test.ts`, `test/smoke.test.ts`, `test/apply-runtime.test.ts`).
- Add focused tests in the same style:
  - cause-extraction tests: ensure `runTool` maps soft vs hard with synthetic `Cause.findErrorOption` + defect cases;
  - scoped cleanup tests under abort/timeout of `runBlitz` (no lock leak, no partial write when aborted);
  - schema evolution tests for compact-vs-core router decision boundaries.
- Add one golden “Tokscale row” test fixture for route metrics to avoid “claimed savings” drift.

## Source Notes (kept/dropped)

### Kept
- `../pi-blitz/src/*` and `../pi-blitz/test/*` files for concrete implementation facts and current behavior.
- Effect v4 docs: Running effects and resource management (`https://effect.website/docs/getting-started/running-effects/`, `https://effect.website/docs/resource-management/introduction/`, `https://effect.website/docs/concurrency/semaphore/`, `https://effect.website/docs/observability/logging/`, `https://effect.website/docs/observability/tracing/`, `https://effect.website/docs/configuration/`).
- Migration docs as API-authoritative rename references: `https://github.com/Effect-TS/effect-smol/blob/main/migration/error-handling.md`, `.../migration/cause.md`, `.../migration/services.md`, `.../MIGRATION.md`.

### Dropped
- Generic secondary blog/forum snippets that do not materially change code decisions.
- Raw SDK examples that add noise but no change to pi-blitz architecture path.

## Version / Date Notes
- Local repo dependency is `effect: 4.0.0-beta.48` (`../pi-blitz/package.json:39-42`).
- External references should be treated as beta-era; migration docs explicitly note beta volatility (`effect-smol MIGRATION.md`).

## Open Questions
1. Should `pi_blitz_route_edit` stay strict no-fallback by design, or should a config-gated compatibility mode allow non-compact fallback for specific projects? (Now it is explicit no internal fallback.)
2. Is it acceptable to add an internal diagnostics log channel (hidden) that records full cause details, or must failures remain strictly minimal at every layer?
3. When introducing `Context.Service`/`Layer`, should we refactor all modules at once or only process orchestration + subprocess boundaries first?

## Builder-Ready Implications (tasks + acceptance criteria)

### Task A: Harden `runTool` boundary classifier
- **Scope:** `src/tool-runtime.ts`, optional helper in `src/tools.ts`.
- **Change:** add explicit soft/hard cause mapping via `Cause` reason checks; keep current output compact (`text` <= one line, `details` short).
- **Acceptance:** existing tests in `test/smoke.test.ts` pass + add 2 new tests for hard/soft mapping under synthetic causes.

### Task B: Introduce lightweight services layer for process/config
- **Scope:** new `src/services.ts` with `Context.Service`/`Layer` + `pi-blitz.ts` composition.
- **Change:** wrap subprocess runner, lock registry, and config reader behind injectable services.
- **Acceptance:** no tool-schema/output changes; add at least one integration test overriding service to mock subprocess and lock behavior.

### Task C: Add scoped lock+snapshot helper
- **Scope:** `src/tools.ts` + `src/paths.ts`.
- **Change:** extract `withFileEditScope(fileSet, effect)` using one acquisition/release abstraction and apply to multi-op routes.
- **Acceptance:** existing rollback tests still pass plus new abort-timeout lock-release test.

### Task D: Logging/observability plane
- **Scope:** `src/tool-runtime.ts`, `src/tools.ts`.
- **Change:** add `Effect.log` + span labels around major stages (`route`, `run-blitz`, `rollback`, `lock`), default logger unchanged externally.
- **Acceptance:** default token output unchanged in tool responses; logs are emitted in dev/test only when enabled.

### Task E: Token budget guardrails
- **Scope:** `src/tools.ts` route decision + details payload.
- **Change:** enforce deterministic fields and explicit reason text for all route outcomes; add optional numeric thresholds in tests.
- **Acceptance:** token budget test suite includes one failing case where `contextSavingsPct <= 0` and `selected=apply_patch` is always consistent.

## Top 3 recommendations to act on first
1. Add explicit Cause-based hard/soft mapping + diagnostic-only error logging (fastest reliability gain).
2. Extract a single scoped file-edit resource helper (`acquireUseRelease`) around lock + snapshot lifecycle.
3. Introduce minimal service layer for subprocess + lock provider first (small surface, big testability gain).

Confidence: **0.86** (high: architecture is clear; recommendations are incremental and evidence-backed).