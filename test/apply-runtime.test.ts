import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mocked spawn runner for this test file only.
const spawnCollectMock = mock(async () => ({
	stdout: JSON.stringify({
		status: "applied",
		operation: "replace_body_span",
		file: "src/app.ts",
		validation: {
			parseClean: true,
		},
		metrics: {
			estimatedPayloadSavedPctVsRealisticAnchor: 33,
			estimatedTokensSavedBytesDiv4VsRealisticAnchor: 88,
			wallMs: 14,
		},
		diffSummary: "+2 -0",
	}),
	stderr: "",
	exitCode: 0,
	durationMs: 10,
}) );

await mock.module("../src/spawn.js", () => ({
	spawnCollectNode: spawnCollectMock,
}));

const tools = await import("../src/tools.js");

describe("pi_blitz_apply runtime path", () => {
	let tmpDir = "";
	let file = "";

	beforeEach(() => {
		spawnCollectMock.mockClear();
		tmpDir = mkdtempSync(join(tmpdir(), "pi-blitz-apply-"));
		file = join(tmpDir, "app.ts");
		writeFileSync(file, "export function foo() { return 1; }\n");
	});

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
			tmpDir = "";
		}
	});

	test("narrow replace_body_span invokes blitz apply with compact schema", async () => {
		const tool = tools.replaceBodySpanToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			symbol: "foo",
			find: "return 1;",
			replace: "return 2;",
			occurrence: "only",
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("replace_body_span");
		expect(payload.target).toEqual({ symbol: "foo", range: "body" });
		expect(payload.edit).toEqual({ find: "return 1;", replace: "return 2;", occurrence: "only" });
	});

	test("narrow wrap_body invokes blitz apply without body text", async () => {
		const tool = tools.wrapBodyToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			symbol: "foo",
			before: "\n  try {",
			after: "  } catch (error) {\n    throw error;\n  }\n",
			indentKeptBodyBy: 2,
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("wrap_body");
		expect(payload.edit).toEqual({
			before: "\n  try {",
			keep: "body",
			after: "  } catch (error) {\n    throw error;\n  }\n",
			indentKeptBodyBy: 2,
		});
	});

	test("narrow multi_body invokes blitz apply with compact edit list", async () => {
		const tool = tools.multiBodyToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			edits: [
				{ symbol: "foo", op: "replace_body_span", find: "return 1;", replace: "return 2;", occurrence: "only" },
				{ symbol: "bar", op: "wrap_body", before: "\n  try {", keep: "body", after: "  } finally {}\n", indentKeptBodyBy: 2 },
			],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("multi_body");
		expect(payload.target).toBeUndefined();
		expect(payload.edit.edits).toEqual([
			{ symbol: "foo", op: "replace_body_span", find: "return 1;", replace: "return 2;", occurrence: "only" },
			{ symbol: "bar", op: "wrap_body", before: "\n  try {", keep: "body", after: "  } finally {}\n", indentKeptBodyBy: 2 },
		]);
	});

	test("narrow patch invokes blitz apply with tuple ops preserved", async () => {
		const tool = tools.patchToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			ops: [
				["replace", "foo", "return 1;", "return 2;", "only"],
				["insert_after", "bar", "anchor();", "next();"],
				["wrap", "baz", "try {", "} finally {}", 2],
				["replace_return", "qux", "value + 1;", 0],
				["try_catch", "zap", "console.error(error);", 4],
			],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("patch");
		expect(payload.target).toBeUndefined();
		expect(payload.edit.ops).toEqual([
			["replace", "foo", "return 1;", "return 2;", "only"],
			["insert_after", "bar", "anchor();", "next();"],
			["wrap", "baz", "try {", "} finally {}", 2],
			["replace_return", "qux", "value + 1;", 0],
			["try_catch", "zap", "console.error(error);", 4],
		]);
	});

	test("narrow try_catch invokes patch tuple", async () => {
		const tool = tools.tryCatchToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			symbol: "handle",
			catchBody: "console.error(error);\nthrow error;",
			indent: 2,
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("patch");
		expect(payload.edit.ops).toEqual([["try_catch", "handle", "console.error(error);\nthrow error;", 2]]);
	});

	test("narrow replace_return invokes patch tuple", async () => {
		const tool = tools.replaceReturnToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			symbol: "handle",
			expr: "value + 1",
			occurrence: "last",
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("patch");
		expect(payload.edit.ops).toEqual([["replace_return", "handle", "value + 1", "last"]]);
	});

	test("invokes blitz apply --edit - --json with JSON IR", async () => {
		const tool = tools.piBlitzApplyToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			file: "app.ts",
			operation: "replace_body_span",
			target: { symbol: "foo" },
			edit: {
				find: "return 1;",
				replace: "return 2;",
			},
			dry_run: true,
			include_diff: true,
		});

		expect(result.isError).toBeUndefined();
		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		expect(result.content[0]?.text).toContain("status=applied");

		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		expect(firstCall).toBeDefined();
		const cmd = firstCall[0];
		const opts = firstCall[1];
		expect(cmd).toEqual(["blitz", "apply", "--edit", "-", "--json", "--dry-run", "--diff"]);
		const payload = JSON.parse(opts.stdin);
		expect(payload.version).toBe(1);
		expect(payload.file).toBe(file);
		expect(payload.operation).toBe("replace_body_span");
		expect(payload.target.symbol).toBe("foo");
		expect(payload.edit).toEqual({ find: "return 1;", replace: "return 2;" });
		expect(payload.options.dryRun).toBe(true);
		expect(payload.options.diffContext).toBe(12);
	});
});
