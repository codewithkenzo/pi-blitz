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

const setSpawnResponse = (response: {
	status: string;
	operation: string;
	file: string;
	validation?: { parseClean?: boolean; parseErrorCount?: number };
	metrics?: {
		estimatedPayloadSavedPctVsRealisticAnchor?: number;
		estimatedTokensSavedBytesDiv4VsRealisticAnchor?: number;
		wallMs?: number;
	};
	diffSummary?: string;
}, options?: { exitCode?: number; stderr?: string }) => {
	spawnCollectMock.mockImplementation(async () => ({
		stdout: JSON.stringify(response),
		stderr: options?.stderr ?? "",
		exitCode: options?.exitCode ?? 0,
		durationMs: 10,
	}));
};
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
			diff_context: 4,
		});

		expect(result.isError).toBeUndefined();
		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		expect(result.content[0]?.text).toContain("blitz patch applied:");

		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		expect(firstCall).toBeDefined();
		const cmd = firstCall[0];
		const opts = firstCall[1];
		expect(cmd).toEqual(["blitz", "--workspace-root", tmpDir, "apply", "--edit", "-", "--json", "--dry-run", "--diff"]);
		const payload = JSON.parse(opts.stdin);
		expect(payload.version).toBe(1);
		expect(payload.file).toBe(file);
		expect(payload.operation).toBe("replace_body_span");
		expect(payload.target.symbol).toBe("foo");
		expect(payload.edit).toEqual({ find: "return 1;", replace: "return 2;" });
		expect(payload.options.dryRun).toBe(true);
		expect(payload.options.diffContext).toBe(4);
	});

	test("diff context requires include_diff", async () => {
		const tool = tools.piBlitzApplyToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			operation: "replace_body_span",
			target: { symbol: "foo" },
			edit: { find: "return 1;", replace: "return 2;" },
			diff_context: 4,
		});

		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		expect(firstCall[0]).not.toContain("--diff");
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.options.diffContext).toBeUndefined();
	});

	test("include_diff defaults diff context to 12", async () => {
		const tool = tools.piBlitzApplyToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			operation: "replace_body_span",
			target: { symbol: "foo" },
			edit: { find: "return 1;", replace: "return 2;" },
			include_diff: true,
		});

		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		expect(firstCall[0]).toContain("--diff");
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.options.diffContext).toBe(12);
	});

	test("options includeDiff accepts camelCase diffContext", async () => {
		const tool = tools.piBlitzApplyToolDef("blitz", tmpDir);
		await tool.execute("1", {
			file: "app.ts",
			operation: "replace_body_span",
			target: { symbol: "foo" },
			edit: { find: "return 1;", replace: "return 2;" },
			options: { includeDiff: true, diffContext: 2 },
		});

		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [string[], { stdin: string }];
		expect(firstCall[0]).toContain("--diff");
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.options.diffContext).toBe(2);
	});

	test("hard failure emits failed update", async () => {
		const tool = tools.piBlitzApplyToolDef("blitz", tmpDir);
		const updates: Array<{ content: Array<{ type: string; text?: string }>; details?: { status?: string } }> = [];
		await expect(tool.execute(
			"1",
			{
				file: "app.ts",
				operation: "replace_body_span",
				target: { symbol: "" },
				edit: { find: "return 1;", replace: "return 2;" },
			},
			undefined,
			(update) => updates.push(update as { content: Array<{ type: string; text?: string }>; details?: { status?: string } }),
		)).rejects.toThrow("InvalidParamsError");

		expect(updates.at(-1)?.content[0]?.text).toBe("blitz: failed");
		expect(updates.at(-1)?.details?.status).toBe("failed");
	});

	test("formats apply applied result compactly", async () => {
		setSpawnResponse({
			status: "applied",
			operation: "replace_return",
			file: "src/app.ts",
			validation: { parseClean: true, parseErrorCount: 0 },
			metrics: {
				estimatedPayloadSavedPctVsRealisticAnchor: 72,
				estimatedTokensSavedBytesDiv4VsRealisticAnchor: 102,
				wallMs: 39,
			},
			diffSummary: "+6/-1",
		});
		const tool = tools.piBlitzApplyToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			file: "app.ts",
			operation: "replace_body_span",
			target: { symbol: "computeTotal" },
			edit: {
				find: "old()",
				replace: "new()",
			},
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text.split("\n").length).toBeLessThanOrEqual(5);
		expect(result.content[0]?.text).toContain("blitz patch applied: src/app.ts");
		expect(result.content[0]?.text).toContain("op: replace_return(computeTotal)");
		expect(result.content[0]?.text).toContain("parse: clean");
		expect(result.content[0]?.text).toContain("changed: +6/-1 · wall: 39ms");
		expect(result.content[0]?.text).toContain("saved: ~72% payload vs realistic-anchor edit");
		expect(result.content[0]?.text.length).toBeLessThanOrEqual(450);
		expect(result.details?.summary).toBeDefined();
	});

	test("excludes savings for preview", async () => {
		setSpawnResponse({
			status: "preview",
			operation: "replace_body_span",
			file: "src/app.ts",
			validation: { parseClean: true, parseErrorCount: 0 },
			metrics: {
				estimatedPayloadSavedPctVsRealisticAnchor: 72,
				wallMs: 17,
			},
			diffSummary: "+2/-0",
		});
		const tool = tools.replaceBodySpanToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			file: "app.ts",
			symbol: "foo",
			find: "old();",
			replace: "new();",
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("blitz patch preview: src/app.ts");
		expect(result.content[0]?.text).not.toContain("saved:");
		expect(result.details?.summary).toBeDefined();
	});

	test("omits savings on dirty parse", async () => {
		setSpawnResponse({
			status: "applied",
			operation: "replace_body_span",
			file: "src/app.ts",
			validation: { parseClean: false, parseErrorCount: 3 },
			metrics: {
				estimatedPayloadSavedPctVsRealisticAnchor: 90,
				wallMs: 16,
			},
			diffSummary: "+1/-1",
		});
		const tool = tools.replaceBodySpanToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			file: "app.ts",
			symbol: "foo",
			find: "old();",
			replace: "new();",
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).not.toContain("saved:");
		expect(result.content[0]?.text).toContain("parse: dirty (3 parse errors)");
		expect(result.content[0]?.text).toContain("blitz patch applied: src/app.ts");
	});

	test("tightens soft error text and details.summary", async () => {
		setSpawnResponse(
			{
				status: "applied",
				operation: "replace_return",
				file: "src/app.ts",
			},
			{ exitCode: 1, stderr: "No occurrences of handleRequest\nsecond line" },
		);
		const tool = tools.replaceReturnToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			file: "app.ts",
			symbol: "handleRequest",
			expr: "value",
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("blitz miss: symbol not found");
		expect(result.content[0]?.text).not.toContain("second line");
		expect(result.content[0]?.text).toContain("next: run pi_blitz_read or use core edit");
		expect(result.content[0]?.text.length).toBeLessThanOrEqual(350);
		expect(result.details?.summary).toBeDefined();
	});

	test("summarizes multi-operation patch response", async () => {
		setSpawnResponse({
			status: "applied",
			operation: "patch",
			file: "src/app.ts",
			validation: { parseClean: true, parseErrorCount: 0 },
			metrics: {
				estimatedPayloadSavedPctVsRealisticAnchor: 55,
				wallMs: 31,
			},
			diffSummary: "+4/-2",
		});
		const tool = tools.patchToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			file: "app.ts",
			ops: [
				["replace", "foo", "x", "y", "first"],
				["replace_return", "bar", "value + 1", "last"],
				["try_catch", "baz", "console.error(error);", 1],
			],
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("op: patch(replace(foo), replace_return(bar), try_catch(baz))");
		expect(result.content[0]?.text.split("\n").length).toBeLessThanOrEqual(5);
	});

	test("single-file mutation emits compact running and done updates", async () => {
		setSpawnResponse({
			status: "applied",
			operation: "replace_body_span",
			file: "src/app.ts",
			validation: { parseClean: true },
			metrics: { wallMs: 12 },
			diffSummary: "+1/-1",
		});
		const tool = tools.replaceBodySpanToolDef("blitz", tmpDir);
		const updates: Array<{ content: Array<{ type: string; text?: string }>; details?: unknown }> = [];
		await tool.execute(
			"1",
			{
				file: "app.ts",
				symbol: "foo",
				find: "old();",
				replace: "new();",
			},
			undefined,
			(update) => updates.push(update),
			{},
		);

		expect(updates).toHaveLength(2);
		expect(updates[0]?.content[0]?.text).toBe("blitz: running replace_body_span");
		expect(updates[1]?.content[0]?.text).toBe("blitz: done");
		expect(updates.every((update) => (update.content[0]?.text?.length ?? 0) <= 120)).toBe(true);
	});

	test("read emits no progress updates", async () => {
		spawnCollectMock.mockImplementation(async () => ({
			stdout: "function foo L1-L1\n",
			stderr: "",
			exitCode: 0,
			durationMs: 10,
		}));
		const tool = tools.readToolDef("blitz", tmpDir);
		const updates: Array<{ content: Array<{ type: string; text?: string }>; details?: unknown }> = [];
		await tool.execute("1", { file: "app.ts" }, undefined, (update) => updates.push(update), {});
		expect(updates).toHaveLength(0);
	});
});
