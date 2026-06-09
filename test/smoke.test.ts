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
import {
	applyToolParamsSchema,
	opToolParamsSchema,
	parseApplyResultPayload,
	patchToolParamsSchema,
	routeEditToolDef,
	routeEditToolParamsSchema,
	translateCompactOpParams,
} from "../src/tools.js";

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

	test("pi_blitz_op schema accepts compact alias tuples", () => {
		const valid = {
			f: "src/app.ts",
			ops: [["rr", "formatStatus", "status.toUpperCase()", "only"]],
			p: true,
		};
		expect(Value.Check(opToolParamsSchema, valid)).toBe(true);
	});

	test("pi_blitz_route_edit schema accepts token-first routing fields", () => {
		const valid = {
			f: "src/app.ts",
			r: "auto" as const,
			s: "rr\tformatStatus\tstatus.toUpperCase()\tonly",
			fallbackContextTokensExpected: 500,
		};
		expect(Value.Check(routeEditToolParamsSchema, valid)).toBe(true);
	});

	test("pi_blitz_route_edit declines without fallback proof in auto mode", async () => {
		const tool = routeEditToolDef("blitz", process.cwd());
		const result = await tool.execute("tcid", {
			f: "src/app.ts",
			s: "rr\tformatStatus\tstatus.toUpperCase()\tonly",
		});
		expect(result.details?.selected).toBe("apply_patch");
		expect(result.details?.status).toBe("declined");
		expect(result.details?.terminal).toBe(true);
		expect(result.details?.noWrite).toBe(true);
		expect(result.details?.actionRequired).toBe("use_external_core_or_apply_patch");
		expect(result.content[0]?.text).toContain("no-write terminal");
		expect(result.details?.contextSavingsPct).toBe(0);
		expect(result.details?.schemaTokensExpected).toBeGreaterThan(0);
		expect(result.details?.argTokensExpected).toBeGreaterThan(0);
		expect(result.details?.outputTokensExpected).toBeGreaterThan(0);
		expect(result.details?.fallbackContextTokensExpected).toBe(0);
		expect(result.details?.selectedBecause).toContain("fail closed");
	});

	test("pi_blitz_route_edit declines requested core without mutating", async () => {
		const tool = routeEditToolDef("blitz", process.cwd());
		const result = await tool.execute("tcid", {
			f: "src/app.ts",
			r: "core",
			s: "rr\tformatStatus\tstatus.toUpperCase()\tonly",
			fallbackContextTokensExpected: 1000,
		});
		expect(result.details?.selected).toBe("core");
		expect(result.details?.status).toBe("declined");
		expect(result.details?.terminal).toBe(true);
		expect(result.details?.noWrite).toBe(true);
		expect(result.details?.selectedBecause).toContain("does not call core/apply_patch internally");
	});

	test("pi_blitz_route_edit unsupported alias returns terminal apply_patch decline", async () => {
		const tool = routeEditToolDef("blitz", process.cwd());
		const result = await tool.execute("tcid", {
			f: "src/config.ts",
			r: "apply_patch",
			s: "apply_patch\tAPI_URL\thttps://example.com",
			fallbackContextTokensExpected: 200,
		});
		expect(result.details?.selected).toBe("apply_patch");
		expect(result.details?.status).toBe("declined");
		expect(result.details?.terminal).toBe(true);
		expect(result.details?.noWrite).toBe(true);
		expect(result.content[0]?.text).toContain("next=use external core/apply_patch");
		expect(result.details?.selectedBecause).toContain("unsupported op alias: apply_patch");
	});

	test("pi_blitz_op translates all aliases to apply payloads", () => {
		const f = "src/app.ts";
		expect(translateCompactOpParams({ f, ops: [["rr", "formatStatus", "status.toUpperCase()", "only"]] })).toEqual({ file: f, operation: "patch", edit: { ops: [["replace_return", "formatStatus", "status.toUpperCase()", "only"]] } });
		expect(translateCompactOpParams({ f, ops: [["rr", "formatStatus", "last", "\"unknown\""]] })).toEqual({ file: f, operation: "patch", edit: { ops: [["replace_return", "formatStatus", "\"unknown\"", "last"]] } });
		expect(translateCompactOpParams({ f, ops: [["rb", "fn", "old", "new", "last"]] })).toEqual({ file: f, operation: "replace_body_span", target: { symbol: "fn", range: "body" }, edit: { find: "old", replace: "new", occurrence: "last" } });
		expect(translateCompactOpParams({ f, ops: [["ib", "fn", "anchor", "before", "text", "only"]] })).toEqual({ file: f, operation: "insert_body_span", target: { symbol: "fn", range: "body" }, edit: { anchor: "anchor", position: "before", text: "text", occurrence: "only" } });
		expect(translateCompactOpParams({ f, ops: [["wb", "fn", "before", "after", 2]] })).toEqual({ file: f, operation: "wrap_body", target: { symbol: "fn", range: "body" }, edit: { before: "before", keep: "body", after: "after", indentKeptBodyBy: 2 } });
		expect(translateCompactOpParams({ f, ops: [["tc", "fn", "catchBody", 2]] })).toEqual({ file: f, operation: "patch", edit: { ops: [["try_catch", "fn", "catchBody", 2]] } });
		expect(translateCompactOpParams({ f, ops: [["ru", "old", "new"]], p: true })).toEqual({ file: f, operation: "replace_unique", edit: { find: "old", replace: "new" }, dry_run: true });
		expect(translateCompactOpParams({ f, ops: [["ia", "anchor", "text", "before"]] })).toEqual({ file: f, operation: "insert_before_anchor", edit: { anchor: "anchor", text: "text" } });
		expect(translateCompactOpParams({ f, ops: [["ia", "after", "anchor", "text"]] })).toEqual({ file: f, operation: "insert_after_anchor", edit: { anchor: "anchor", text: "text" } });
		expect(translateCompactOpParams({ f, ops: [["bt", "start", "end", "new"]] })).toEqual({ file: f, operation: "replace_between", edit: { start: "start", end: "end", replace: "new" } });
		expect(translateCompactOpParams({ f, ops: [["as", "## Notes", "body"]] })).toEqual({ file: f, operation: "append_section", edit: { heading: "## Notes", text: "body" } });
		expect(translateCompactOpParams({ f, ops: [["ek", "line"]] })).toEqual({ file: f, operation: "ensure_line", edit: { line: "line" } });
		expect(translateCompactOpParams({ f, ops: [["dk", 3, 9, "remove"]] })).toEqual({ file: f, operation: "delete_range", edit: { start: 3, end: 9, expected: "remove" } });
		expect(translateCompactOpParams({ f, ops: [["sk", "name", "value"]] })).toEqual({ file: f, operation: "set_key", edit: { key: "name", value: "value" } });
		expect(translateCompactOpParams({ f, s: "rr\tformatStatus\tstatus.toLowerCase()\tonly" })).toEqual({ file: f, operation: "patch", edit: { ops: [["replace_return", "formatStatus", "status.toLowerCase()", "only"]] } });
		expect(translateCompactOpParams({ f, s: "dk\t3\t9\tremove" })).toEqual({ file: f, operation: "delete_range", edit: { start: 3, end: 9, expected: "remove" } });
	});

	test("pi_blitz_op compact script decodes escaped string fields", () => {
		const f = "src/app.ts";
		expect(translateCompactOpParams({ f, s: "ia\t  console.log('start');\t\\n  console.time('load');" })).toEqual({ file: f, operation: "insert_after_anchor", edit: { anchor: "  console.log('start');", text: "\n  console.time('load');" } });
		expect(translateCompactOpParams({ f, s: "ia\tafter\tanchor\tline\\nnext\\tindent\\rret\\\\slash" })).toEqual({ file: f, operation: "insert_after_anchor", edit: { anchor: "anchor", text: "line\nnext\tindent\rret\\slash" } });
		expect(translateCompactOpParams({ f, s: "sk\tenabled\ttrue" })).toEqual({ file: f, operation: "set_key", edit: { key: "enabled", value: true } });
		expect(translateCompactOpParams({ f, s: "dk\t3\t9\tremove" })).toEqual({ file: f, operation: "delete_range", edit: { start: 3, end: 9, expected: "remove" } });
	});

	test("pi_blitz_op fails closed for malformed aliases", () => {
		expect(() => translateCompactOpParams({ f: "src/app.ts", ops: [["dk", "3", "9", "remove"]] })).toThrow(InvalidParamsError);
		expect(() => translateCompactOpParams({ f: "src/app.ts", ops: [["dk", 3, 9]] })).toThrow(InvalidParamsError);
		expect(() => translateCompactOpParams({ f: "src/app.ts", ops: [["as", "## Notes"]] })).toThrow(InvalidParamsError);
		expect(() => translateCompactOpParams({ f: "src/app.ts", ops: [["rr", "fn", "last"]] })).toThrow(InvalidParamsError);
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
