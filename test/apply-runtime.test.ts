import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type SpawnCallOptions = { stdin?: string };

const successResult = () => ({
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
});

const defaultSpawnCollect = async (
	_cmd: string[] = [],
	_options: SpawnCallOptions = {},
) => successResult();

const applyExactOpsFromStdin = (stdin = "") => {
	const payload = JSON.parse(stdin) as {
		file?: string;
		f?: string;
		ops?: string[][];
	};
	const target = payload.file ?? payload.f;
	if (!target || !payload.ops) return;
	let content = readFileSync(target, "utf8");
	for (const op of payload.ops) {
		if (op[0] !== "x") continue;
		const oldText = op[1] ?? "";
		const newText = op[2] ?? "";
		if (!content.includes(oldText)) {
			throw new Error(`NO_MATCH ${oldText}`);
		}
		content = content.replace(oldText, newText);
	}
	writeFileSync(target, content);
};

const mutatingSpawnCollect = async (
	cmd: string[] = [],
	options: SpawnCallOptions = {},
) => {
	if (!cmd.includes("--dry-run")) {
		applyExactOpsFromStdin(options.stdin);
	}
	return successResult();
};

// Mocked spawn runner for this test file only.
const spawnCollectMock = mock(defaultSpawnCollect);

await mock.module("../src/spawn.js", () => ({
	spawnCollectNode: spawnCollectMock,
}));

const tools = await import("../src/tools.js");

describe("pi_blitz_apply runtime path", () => {
	let tmpDir = "";
	let file = "";

	beforeEach(() => {
		spawnCollectMock.mockClear();
		spawnCollectMock.mockImplementation(defaultSpawnCollect);
		tmpDir = mkdtempSync(join(tmpdir(), "pi-blitz-apply-"));
		file = join(tmpDir, "app.ts");
		writeFileSync(file, "export function foo() { return 1; }\n");
		writeFileSync(
			join(tmpDir, "other.ts"),
			"export function bar() { return 3; }\n",
		);
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
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("replace_body_span");
		expect(payload.target).toEqual({ symbol: "foo", range: "body" });
		expect(payload.edit).toEqual({
			find: "return 1;",
			replace: "return 2;",
			occurrence: "only",
		});
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
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
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
				{
					symbol: "foo",
					op: "replace_body_span",
					find: "return 1;",
					replace: "return 2;",
					occurrence: "only",
				},
				{
					symbol: "bar",
					op: "wrap_body",
					before: "\n  try {",
					keep: "body",
					after: "  } finally {}\n",
					indentKeptBodyBy: 2,
				},
			],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("multi_body");
		expect(payload.target).toBeUndefined();
		expect(payload.edit.edits).toEqual([
			{
				symbol: "foo",
				op: "replace_body_span",
				find: "return 1;",
				replace: "return 2;",
				occurrence: "only",
			},
			{
				symbol: "bar",
				op: "wrap_body",
				before: "\n  try {",
				keep: "body",
				after: "  } finally {}\n",
				indentKeptBodyBy: 2,
			},
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
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
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
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("patch");
		expect(payload.edit.ops).toEqual([
			["try_catch", "handle", "console.error(error);\nthrow error;", 2],
		]);
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
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		const payload = JSON.parse(firstCall[1].stdin);
		expect(payload.operation).toBe("patch");
		expect(payload.edit.ops).toEqual([
			["replace_return", "handle", "value + 1", "last"],
		]);
	});

	test("blitz_edit applies same-file multi exact ops with rollback-backed atomic reporting", async () => {
		writeFileSync(
			file,
			"export function foo() {\n  const a = 1;\n  return 1;\n}\n",
		);
		spawnCollectMock.mockImplementation(mutatingSpawnCollect);
		const tool = tools.blitzEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			e: [
				["x", "return 1;", "return 2;"],
				["x", "const a = 1;", "const a = 2;"],
			],
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("groupedApply=false");
		expect(result.content[0]?.text).toContain("sequentialApply=true");
		expect(result.content[0]?.text).toContain("sameFileAtomic=true");
		expect(result.details?.groupedApply).toBe(false);
		expect(result.details?.sequentialApply).toBe(true);
		expect(result.details?.sameFileAtomic).toBe(true);
		expect(result.details?.crossFileAtomic).toBe(true);
		expect(result.details?.atomicityNote).toContain("rollback-backed atomic");
		expect(spawnCollectMock).toHaveBeenCalledTimes(4);

		const firstPreview = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		const secondPreview = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		const firstApply = spawnCollectMock.mock.calls[2] as unknown as [
			string[],
			{ stdin: string },
		];
		const secondApply = spawnCollectMock.mock.calls[3] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(firstPreview[0]).toEqual([
			"blitz",
			"--workspace-root",
			tmpDir,
			"apply",
			"--edit",
			"-",
			"--json",
			"--dry-run",
		]);
		expect(secondPreview[0]).toContain("--dry-run");
		expect(firstApply[0]).toEqual([
			"blitz",
			"--workspace-root",
			tmpDir,
			"apply",
			"--edit",
			"-",
			"--json",
		]);
		expect(secondApply[0]).not.toContain("--dry-run");
		expect(JSON.parse(firstPreview[1].stdin).ops).toEqual([
			["x", "return 1;", "return 2;"],
		]);
		expect(JSON.parse(secondPreview[1].stdin).ops).toEqual([
			["x", "const a = 1;", "const a = 2;"],
		]);
		expect(JSON.parse(firstApply[1].stdin).ops).toEqual([
			["x", "return 1;", "return 2;"],
		]);
		expect(JSON.parse(secondApply[1].stdin).ops).toEqual([
			["x", "const a = 1;", "const a = 2;"],
		]);
		expect(readFileSync(file, "utf8")).toBe(
			"export function foo() {\n  const a = 2;\n  return 2;\n}\n",
		);
	});

	test("blitz_edit surfaces nonzero Blitz JSON stdout errors", async () => {
		spawnCollectMock.mockImplementationOnce(async () => ({
			stdout: JSON.stringify({
				code: "UNSUPPORTED_OPERATION",
				reason: "grouped exact replacement unsupported",
			}),
			stderr: "",
			exitCode: 1,
			durationMs: 10,
		}));

		const tool = tools.blitzEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			e: [["x", "return 1;", "return 2;"]],
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("UNSUPPORTED_OPERATION");
		expect(result.content[0]?.text).toContain(
			"grouped exact replacement unsupported",
		);
		expect(result.content[0]?.text).not.toBe("pi-blitz blitz-error: ");
	});

	test("blitz_edit reports safe-unit unsupported failure explicitly", async () => {
		spawnCollectMock.mockImplementationOnce(async () => ({
			stdout: "",
			stderr: JSON.stringify({
				code: "UNSUPPORTED_OPERATION",
				reason: "same-file grouped exact replacement unsupported",
			}),
			exitCode: 1,
			durationMs: 10,
		}));

		const tool = tools.blitzEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			e: [
				["x", "return 1;", "return 2;"],
				["x", "const a = 1;", "const a = 2;"],
			],
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("UNSUPPORTED_OPERATION");
		expect(result.content[0]?.text).toContain(
			"same-file grouped exact replacement unsupported",
		);
		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
	});

	test("blitz_edit applies cross-file batches with rollback-backed atomic reporting", async () => {
		spawnCollectMock.mockImplementation(mutatingSpawnCollect);
		const tool = tools.blitzEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			e: [
				["x", "app.ts", "return 1;", "return 2;"],
				["x", "other.ts", "return 3;", "return 4;"],
			],
		});

		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("crossFileAtomic=true");
		expect(result.details?.sameFileAtomic).toBe(true);
		expect(result.details?.crossFileAtomic).toBe(true);
		expect(result.details?.atomicityNote).toContain("rollback-backed atomic");
		expect(spawnCollectMock).toHaveBeenCalledTimes(4);
		const first = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		const second = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		const third = spawnCollectMock.mock.calls[2] as unknown as [
			string[],
			{ stdin: string },
		];
		const fourth = spawnCollectMock.mock.calls[3] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(first[0]).toContain("--dry-run");
		expect(second[0]).toContain("--dry-run");
		expect(third[0]).not.toContain("--dry-run");
		expect(fourth[0]).not.toContain("--dry-run");
		expect(readFileSync(file, "utf8")).toBe(
			"export function foo() { return 2; }\n",
		);
		expect(readFileSync(join(tmpDir, "other.ts"), "utf8")).toBe(
			"export function bar() { return 4; }\n",
		);
	});

	test("blitz_edit rolls back earlier mutations when a later apply fails", async () => {
		const beforeApp = readFileSync(file, "utf8");
		const beforeOther = readFileSync(join(tmpDir, "other.ts"), "utf8");
		let call = 0;
		spawnCollectMock.mockImplementation(async () => {
			call += 1;
			if (call === 3) {
				writeFileSync(file, "export function foo() { return 2; }\n");
			}
			if (call === 4) {
				return {
					stdout: JSON.stringify({
						code: "NO_MATCH",
						reason: "second apply failed",
					}),
					stderr: "",
					exitCode: 1,
					durationMs: 10,
				};
			}
			return defaultSpawnCollect();
		});

		const tool = tools.blitzEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			e: [
				["x", "app.ts", "return 1;", "return 2;"],
				["x", "other.ts", "return 3;", "return 4;"],
			],
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("NO_MATCH");
		expect(result.content[0]?.text).toContain("rollbackAttempted=true");
		expect(result.content[0]?.text).toContain("rollbackSucceeded=true");
		expect(result.details?.status).toBe("rolled-back");
		expect(result.details?.rollbackAttempted).toBe(true);
		expect(result.details?.rollbackSucceeded).toBe(true);
		expect(result.details?.rollbackFiles).toBe(2);
		expect(result.details?.failedApplyIndex).toBe(1);
		expect(readFileSync(file, "utf8")).toBe(beforeApp);
		expect(readFileSync(join(tmpDir, "other.ts"), "utf8")).toBe(beforeOther);
		expect(spawnCollectMock).toHaveBeenCalledTimes(4);
	});

	test("blitz_edit rolls back earlier mutations when a later apply throws", async () => {
		const beforeApp = readFileSync(file, "utf8");
		const beforeOther = readFileSync(join(tmpDir, "other.ts"), "utf8");
		let call = 0;
		spawnCollectMock.mockImplementation(async () => {
			call += 1;
			if (call === 3) {
				writeFileSync(file, "export function foo() { return 2; }\n");
				return successResult();
			}
			if (call === 4) {
				throw new Error("simulated timeout after partial mutation");
			}
			return successResult();
		});

		const tool = tools.blitzEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			e: [
				["x", "app.ts", "return 1;", "return 2;"],
				["x", "other.ts", "return 3;", "return 4;"],
			],
		});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("hard-apply-error");
		expect(result.content[0]?.text).toContain("rollbackAttempted=true");
		expect(result.content[0]?.text).toContain("rollbackSucceeded=true");
		expect(result.details?.reason).toBe("hard-apply-error");
		expect(result.details?.status).toBe("rolled-back");
		expect(result.details?.rollbackAttempted).toBe(true);
		expect(result.details?.rollbackSucceeded).toBe(true);
		expect(result.details?.failedApplyIndex).toBe(1);
		expect(readFileSync(file, "utf8")).toBe(beforeApp);
		expect(readFileSync(join(tmpDir, "other.ts"), "utf8")).toBe(beforeOther);
		expect(spawnCollectMock).toHaveBeenCalledTimes(4);
	});

	test("blitz_edit reports incomplete rollback truthfully", async () => {
		let call = 0;
		spawnCollectMock.mockImplementation(async () => {
			call += 1;
			if (call === 3) {
				writeFileSync(file, "export function foo() { return 2; }\n");
				chmodSync(file, 0o400);
				return successResult();
			}
			if (call === 4) {
				throw new Error("simulated later hard failure");
			}
			return successResult();
		});

		try {
			const tool = tools.blitzEditToolDef("blitz", tmpDir);
			const result = await tool.execute("1", {
				e: [
					["x", "app.ts", "return 1;", "return 2;"],
					["x", "other.ts", "return 3;", "return 4;"],
				],
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("rollbackAttempted=true");
			expect(result.content[0]?.text).toContain("rollbackSucceeded=false");
			expect(result.details?.status).toBe("rollback-incomplete");
			expect(result.details?.rollbackSucceeded).toBe(false);
			expect(Array.isArray(result.details?.rollbackErrors)).toBe(true);
			expect(result.details?.atomicityNote).toContain("rollback was incomplete");
			expect(result.details?.atomicityNote).not.toContain("restored all touched files");
		} finally {
			chmodSync(file, 0o600);
		}
	});

	test("route edit accepts replace exact alias and sends normalized Blitz op", async () => {
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			p: true,
			d: true,
			ops: [["replace", "return 1;", "return 2;"]],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(2);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		const secondCall = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(firstCall[0]).toContain("--dry-run");
		expect(secondCall[0]).not.toContain("--dry-run");
		expect(JSON.parse(secondCall[1].stdin).ops).toEqual([
			["x", "return 1;", "return 2;"],
		]);
		expect(result.isError).toBeUndefined();
		expect(result.details?.selected).toBe("blitz");
		expect(result.details?.tool).toBe("pi_blitz_op");
		expect(result.details?.selectedBecause).toContain("requested blitz");
	});

	test("route edit accepts replace line-range alias as exact old/new op", async () => {
		writeFileSync(
			file,
			"const before = true;\nfunction smallTarget() {\n  return 1;\n}\nconst after = true;\n",
		);
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			p: true,
			d: true,
			ops: [["replace", 2, 4, "function smallTarget() {\n  return 2;\n}"]],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(2);
		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		const secondCall = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(firstCall[0]).toContain("--dry-run");
		expect(secondCall[0]).not.toContain("--dry-run");
		expect(JSON.parse(secondCall[1].stdin).ops).toEqual([
			[
				"x",
				"function smallTarget() {\n  return 1;\n}",
				"function smallTarget() {\n  return 2;\n}",
			],
		]);
		expect(result.isError).toBeUndefined();
		expect(result.details?.selected).toBe("blitz");
	});

	test("route edit accepts replace line/column alias as single-line exact op", async () => {
		writeFileSync(
			file,
			'const helper = makeHelper();\n\nfunction smallTarget(name: string): string {\n  return "hi " + name;\n}\n',
		);
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			p: true,
			d: true,
			ops: [["replace", 4, 3, '  return "hello " + name.toUpperCase();']],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(2);
		const secondCall = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(JSON.parse(secondCall[1].stdin).ops).toEqual([
			[
				"x",
				'  return "hi " + name;',
				'  return "hello " + name.toUpperCase();',
			],
		]);
		expect(result.isError).toBeUndefined();
		expect(result.details?.selected).toBe("blitz");
	});

	test("route edit accepts replace start/end line-column alias as exact op", async () => {
		writeFileSync(file, "a\nb\nc\n");
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			p: true,
			d: true,
			ops: [["replace", 1, 7, 3, 1, "x\ny\nz"]],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(2);
		const secondCall = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(JSON.parse(secondCall[1].stdin).ops).toEqual([["x", "a\nb\nc", "x\ny\nz"]]);
		expect(result.isError).toBeUndefined();
		expect(result.details?.selected).toBe("blitz");
	});

	test("route edit maps function header line replace to body line", async () => {
		writeFileSync(
			file,
			'const helper = makeHelper();\n\nfunction smallTarget(name: string): string {\n  return "hi " + name;\n}\n',
		);
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			p: true,
			d: true,
			ops: [["replace", 3, 3, '  return "hello " + name.toUpperCase();']],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(2);
		const secondCall = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(JSON.parse(secondCall[1].stdin).ops).toEqual([
			[
				"x",
				'  return "hi " + name;',
				'  return "hello " + name.toUpperCase();',
			],
		]);
		expect(result.isError).toBeUndefined();
		expect(result.details?.selected).toBe("blitz");
	});

	test("route edit maps line one whole-file replacement without prepending", async () => {
		writeFileSync(file, "export const CONFIG = {\n  logLevel: \"info\",\n};\n");
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			p: true,
			d: true,
			ops: [["replace", 1, 1, "export const CONFIG = {\n  logLevel: \"debug\",\n};\n"]],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(2);
		const secondCall = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(JSON.parse(secondCall[1].stdin).ops).toEqual([
			[
				"x",
				"export const CONFIG = {\n  logLevel: \"info\",\n};\n",
				"export const CONFIG = {\n  logLevel: \"debug\",\n};\n",
			],
		]);
		expect(result.isError).toBeUndefined();
		expect(result.details?.selected).toBe("blitz");
	});

	test("route edit treats non-script s as whole-file replacement", async () => {
		writeFileSync(file, "export function value() {\n  return 1;\n}\n");
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			p: true,
			d: true,
			s: "export function value() {\n  return 2;\n}",
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(2);
		const secondCall = spawnCollectMock.mock.calls[1] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(JSON.parse(secondCall[1].stdin).ops).toEqual([
			[
				"x",
				"export function value() {\n  return 1;\n}\n",
				"export function value() {\n  return 2;\n}",
			],
		]);
		expect(result.isError).toBeUndefined();
		expect(result.details?.selected).toBe("blitz");
	});

	test("route edit declines snippet-like non-script s without calling Blitz", async () => {
		writeFileSync(file, "const header = true;\n\nexport function value() {\n  return 1;\n}\n");
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			s: "function value() {\n  return 2;\n}",
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(0);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("pi-blitz route declined");
		expect(result.content[0]?.text).toContain("no-write terminal");
		expect(result.details?.status).toBe("declined");
		expect(result.details?.noWrite).toBe(true);
		expect(result.details?.selected).toBe("apply_patch");
		expect(readFileSync(file, "utf8")).toBe(
			"const header = true;\n\nexport function value() {\n  return 1;\n}\n",
		);
	});

	test("route edit declines ambiguous header signature replacement", async () => {
		writeFileSync(file, "function value(name: string): string {\n  return name;\n}\n");
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			ops: [["replace", 1, 1, "function renamed(name: string): string {"]],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(0);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("pi-blitz route declined");
		expect(result.details?.status).toBe("declined");
		expect(result.details?.noWrite).toBe(true);
		expect(result.details?.selected).toBe("apply_patch");
		expect(readFileSync(file, "utf8")).toBe(
			"function value(name: string): string {\n  return name;\n}\n",
		);
	});

	test("route edit declines multiline header signature replacement", async () => {
		writeFileSync(file, "function value(name: string): string {\n  return name;\n}\n");
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			ops: [
				[
					"replace",
					1,
					1,
					"function renamed(name: string): string {\n  return name.toUpperCase();\n}",
				],
			],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(0);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("pi-blitz route declined");
		expect(result.details?.status).toBe("declined");
		expect(result.details?.noWrite).toBe(true);
		expect(result.details?.selected).toBe("apply_patch");
		expect(readFileSync(file, "utf8")).toBe(
			"function value(name: string): string {\n  return name;\n}\n",
		);
	});

	test("route edit accepts insert_after text alias in mixed same-file ops", async () => {
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			d: true,
			ops: [
				["replace", "return 1;", "return 2;"],
				["insert_after", "const marker = value;", "\n  const markerUpper = value.toUpperCase();"],
				["replace", "throw value;", "throw error;"],
			],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(6);
		const payloads = spawnCollectMock.mock.calls.map((call) =>
			JSON.parse((call as unknown as [string[], { stdin: string }])[1].stdin),
		);
		expect(payloads.map((payload) => payload.operation)).toEqual([
			"replace_unique",
			"insert_after_anchor",
			"replace_unique",
			"replace_unique",
			"insert_after_anchor",
			"replace_unique",
		]);
		expect(payloads[1].edit).toEqual({
			anchor: "const marker = value;",
			text: "\n  const markerUpper = value.toUpperCase();",
		});
		expect(result.isError).toBeUndefined();
		expect(result.details?.selected).toBe("blitz");
	});

	test("route edit declines unsupported compact aliases without calling Blitz", async () => {
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			p: true,
			d: true,
			ops: [["rewrite_everything", "return 1;", "return 1;"]],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(0);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("pi-blitz route declined");
		expect(result.content[0]?.text).toContain("no-write terminal");
		expect(result.details?.status).toBe("declined");
		expect(result.details?.noWrite).toBe(true);
		expect(result.details?.selected).toBe("apply_patch");
		expect(result.details?.tool).toBe("pi_blitz_route_edit");
		expect(result.details?.selectedBecause).toContain(
			"unsupported Blitz route payload declined without writes",
		);
		expect(result.details?.selectedBecause).toContain(
			"no internal core/apply_patch fallback",
		);
		expect(readFileSync(file, "utf8")).toBe(
			"export function foo() { return 1; }\n",
		);
	});

	test("route edit converts Blitz unsupported-operation soft errors to safe no-write decline", async () => {
		spawnCollectMock.mockImplementationOnce(async () => ({
			stdout: JSON.stringify({ code: "UNSUPPORTED_OPERATION" }),
			stderr: "",
			exitCode: 1,
			durationMs: 10,
		}));
		const tool = tools.routeEditToolDef("blitz", tmpDir);
		const result = await tool.execute("1", {
			f: "app.ts",
			r: "blitz",
			d: true,
			ops: [["ru", "missing", "replacement"]],
		});

		expect(spawnCollectMock).toHaveBeenCalledTimes(1);
		expect(result.isError).toBeUndefined();
		expect(result.content[0]?.text).toContain("pi-blitz route declined");
		expect(result.details?.status).toBe("declined");
		expect(result.details?.noWrite).toBe(true);
		expect(result.details?.selected).toBe("apply_patch");
		expect(result.details?.tool).toBe("pi_blitz_route_edit");
		expect(result.details?.selectedBecause).toContain(
			"Blitz route payload produced no-write error and was declined safely",
		);
		expect(result.details?.selectedBecause).toContain(
			"no internal core/apply_patch fallback",
		);
		expect(readFileSync(file, "utf8")).toBe(
			"export function foo() { return 1; }\n",
		);
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

		const firstCall = spawnCollectMock.mock.calls[0] as unknown as [
			string[],
			{ stdin: string },
		];
		expect(firstCall).toBeDefined();
		const cmd = firstCall[0];
		const opts = firstCall[1];
		expect(cmd).toEqual([
			"blitz",
			"--workspace-root",
			tmpDir,
			"apply",
			"--edit",
			"-",
			"--json",
			"--dry-run",
			"--diff",
		]);
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
