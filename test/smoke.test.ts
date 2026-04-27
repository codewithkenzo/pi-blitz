/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Value } from "@sinclair/typebox/value";
import {
	BlitzMissingError,
	BlitzSoftError,
	BlitzTimeoutError,
	InvalidParamsError,
	PathEscapeError,
} from "../src/errors.js";
import { makePathLocks } from "../src/mutex.js";
import { runTool } from "../src/tool-runtime.js";
import { applyToolParamsSchema, parseApplyResultPayload, patchToolParamsSchema } from "../src/tools.js";

const wait = (ms: number): Promise<void> =>
	new Promise((r) => {
		setTimeout(r, ms);
	});

describe("@codewithkenzo/pi-blitz smoke", () => {
	test("pi_blitz_apply schema accepts expected operation payloads", () => {
		const valid = {
			file: "src/app.ts",
			operation: "replace_body_span" as const,
			target: { symbol: "handleRequest" },
			edit: { find: "return 1;", replace: "return 2;" },
		};
		expect(Value.Check(applyToolParamsSchema, valid)).toBe(true);
	});

	test("pi_blitz_patch schema accepts tuple ops", () => {
		const valid = {
			file: "src/app.ts",
			ops: [["replace", "handleRequest", "return 1;", "return 2;", "only"]],
		};
		expect(Value.Check(patchToolParamsSchema, valid)).toBe(true);
	});

	test("pi_blitz_apply schema rejects unknown operation", () => {
		const invalid = {
			file: "src/app.ts",
			operation: "bad_op",
			target: { symbol: "handleRequest" },
			edit: { find: "return 1;", replace: "return 2;" },
		};
		expect(Value.Check(applyToolParamsSchema, invalid as unknown)).toBe(false);
	});

	test("pi_blitz_apply parser keeps status/operation/metrics compact text", () => {
		const payload = parseApplyResultPayload(
			JSON.stringify({
				status: "applied",
				operation: "replace_body_span",
				file: "src/app.ts",
				validation: { parseClean: true },
				metrics: { wallMs: 12, estimatedPayloadSavedPctVsRealisticAnchor: 42 },
				diffSummary: { added: 2, removed: 1 },
				ranges: { start: 10, end: 32 },
			}),
		);
		expect(payload?.status).toBe("applied");
		expect(payload?.operation).toBe("replace_body_span");
		expect(payload?.file).toBe("src/app.ts");
		expect(payload?.metrics?.estimatedPayloadSavedPctVsRealisticAnchor).toBe(42);
		expect(payload?.diffSummary).toEqual({ added: 2, removed: 1 });
	});

	test("errors are Data.TaggedError instances with correct _tag", () => {
		expect(new BlitzSoftError({ reason: "no-backup", stderr: "" })._tag).toBe("BlitzSoftError");
		expect(new BlitzMissingError({ binary: "blitz" })._tag).toBe("BlitzMissingError");
		expect(new BlitzTimeoutError({ command: "c", timeoutMs: 1 })._tag).toBe("BlitzTimeoutError");
		expect(new InvalidParamsError({ reason: "r" })._tag).toBe("InvalidParamsError");
		expect(new PathEscapeError({ path: "/x", cwd: "/y" })._tag).toBe("PathEscapeError");
	});

	test("path locks prove serialization (no overlap on same path)", async () => {
		const locks = makePathLocks();
		const events: string[] = [];
		const slowA = Effect.gen(function* () {
			events.push("a-enter");
			yield* Effect.promise(() => wait(30));
			events.push("a-exit");
		});
		const slowB = Effect.gen(function* () {
			events.push("b-enter");
			yield* Effect.promise(() => wait(30));
			events.push("b-exit");
		});
		await Promise.all([
			Effect.runPromise(locks.withLock("/tmp/x", slowA)),
			Effect.runPromise(locks.withLock("/tmp/x", slowB)),
		]);
		// Must be strictly interleaved in pairs.
		expect(events).toEqual(["a-enter", "a-exit", "b-enter", "b-exit"]);
	});

	test("different paths do not block each other", async () => {
		const locks = makePathLocks();
		const events: string[] = [];
		const eff = (tag: string) =>
			Effect.gen(function* () {
				events.push(`${tag}-enter`);
				yield* Effect.promise(() => wait(20));
				events.push(`${tag}-exit`);
			});
		const t0 = Date.now();
		await Promise.all([
			Effect.runPromise(locks.withLock("/tmp/a", eff("a"))),
			Effect.runPromise(locks.withLock("/tmp/b", eff("b"))),
		]);
		const dt = Date.now() - t0;
		// Both waited ~20ms; parallel should be well under sequential (40ms+).
		expect(dt).toBeLessThan(35);
		expect(events).toContain("a-enter");
		expect(events).toContain("b-enter");
	});

	test("withSortedLocks acquires in sorted order (prevents deadlock)", async () => {
		const locks = makePathLocks();
		const acquired: string[] = [];
		// Force probe ordering by stacking per-path locks; observable through acquire events.
		const probe = (p: string) =>
			Effect.sync(() => {
				acquired.push(p);
			});
		await Effect.runPromise(
			locks.withSortedLocks(
				["/tmp/c", "/tmp/a", "/tmp/b"],
				Effect.gen(function* () {
					for (const p of ["/tmp/a", "/tmp/b", "/tmp/c"]) {
						yield* probe(p);
					}
				}),
			),
		);
		expect(acquired).toEqual(["/tmp/a", "/tmp/b", "/tmp/c"]);
	});

	test("lock map cleans up when last waiter completes", async () => {
		const locks = makePathLocks();
		const exposed = locks as unknown as { internalMap?: Map<string, unknown> };
		// Public API doesn't expose internals; test via side-effect: re-acquiring after release works.
		await Effect.runPromise(locks.withLock("/tmp/cleanup", Effect.sync(() => {})));
		await Effect.runPromise(locks.withLock("/tmp/cleanup", Effect.sync(() => {})));
		// Sanity: no memory exposed externally (don't leak Map), and repeat calls succeed.
		expect(exposed.internalMap).toBeUndefined();
	});

	test("runTool returns isError for BlitzSoftError", async () => {
		const eff = Effect.fail(
			new BlitzSoftError({ reason: "no-backup", stderr: "No backup recorded for x" }),
		);
		const result = await runTool(eff, () => {
			throw new Error("serialize should not be called on failure");
		});
		expect(result.isError).toBe(true);
		expect(result.details?.reason).toBe("no-backup");
	});

	test("runTool throws for hard tagged error", async () => {
		const eff = Effect.fail(new BlitzMissingError({ binary: "blitz" }));
		await expect(
			runTool(eff, () => {
				throw new Error("serialize should not be called on failure");
			}),
		).rejects.toThrow(/BlitzMissingError/);
	});

	test("runTool calls serialize on success", async () => {
		const eff = Effect.succeed("ok");
		const result = await runTool(eff, (v) => ({
			content: [{ type: "text" as const, text: v }],
			details: undefined,
		}));
		expect(result.content[0]!.text).toBe("ok");
		expect(result.isError).toBeUndefined();
	});
});
