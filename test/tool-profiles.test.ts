/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piBlitz, { resolveBundledBlitzBinary } from "../index.js";
import {
	getProfiledToolNames,
	profileLabel,
	resolvePiBlitzToolProfile,
	serializeToolSpecs,
} from "../src/tool-profiles.js";

const originalProfileEnv = process.env.PI_BLITZ_TOOL_PROFILE;

afterEach(() => {
	if (originalProfileEnv === undefined)
		delete process.env.PI_BLITZ_TOOL_PROFILE;
	else process.env.PI_BLITZ_TOOL_PROFILE = originalProfileEnv;
});

type BlitzEditResult = {
	isError?: boolean;
	content: Array<{ text?: string }>;
	details?: Record<string, unknown>;
};

type BlitzEditTool = {
	execute: (
		tcid: string,
		params: { f?: string; e: Array<["x", string, string] | ["x", string, string, string]> },
	) => Promise<BlitzEditResult>;
};

const createFakePi = () => {
	const registeredToolNames: string[] = [];
	const registeredTools: Array<{ name: string; execute?: unknown }> = [];
	const resourceHandlers: Array<() => { skillPaths: string[] }> = [];
	const pi = {
		registerTool(tool: { name: string; execute?: unknown }) {
			registeredToolNames.push(tool.name);
			registeredTools.push(tool);
		},
		on(event: string, handler: () => { skillPaths: string[] }) {
			if (event === "resources_discover") resourceHandlers.push(handler);
		},
	} as Parameters<typeof piBlitz>[0];

	return { pi, registeredToolNames, registeredTools, resourceHandlers };
};

describe("pi-blitz tool profiles", () => {
	test("minimal profile is minimal-v0 and registers only default Blitz edit surface", () => {
		expect(profileLabel("minimal")).toBe("minimal-v0");
		expect(getProfiledToolNames("minimal")).toEqual(["blitz_edit"]);
	});

	test("semantic profile omits structural/admin schemas", () => {
		expect(getProfiledToolNames("semantic")).toEqual([
			"pi_blitz_op",
			"pi_blitz_patch",
			"pi_blitz_try_catch",
			"pi_blitz_replace_return",
		]);
		expect(getProfiledToolNames("semantic")).not.toContain("pi_blitz_read");
		expect(getProfiledToolNames("semantic")).not.toContain("pi_blitz_apply");
	});

	test("router profile exposes only runtime route facade", () => {
		expect(getProfiledToolNames("router")).toEqual(["pi_blitz_route_edit"]);
		expect(getProfiledToolNames("router")).not.toContain("pi_blitz_op");
		expect(getProfiledToolNames("router")).not.toContain("pi_blitz_apply");
	});

	test("structural profile exposes compact structural tools without legacy/full/admin tools", () => {
		expect(getProfiledToolNames("structural")).toEqual([
			"pi_blitz_op",
			"pi_blitz_replace_body_span",
			"pi_blitz_multi_body",
			"pi_blitz_patch",
		]);
		expect(getProfiledToolNames("structural")).not.toContain("pi_blitz_doctor");
		expect(getProfiledToolNames("structural")).not.toContain("pi_blitz_edit");
		expect(getProfiledToolNames("structural")).not.toContain(
			"pi_blitz_wrap_body",
		);
	});

	test("admin profile exposes admin helpers only", () => {
		expect(getProfiledToolNames("admin")).toEqual([
			"pi_blitz_read",
			"pi_blitz_rename",
			"pi_blitz_undo",
			"pi_blitz_doctor",
		]);
		expect(getProfiledToolNames("admin")).not.toContain("pi_blitz_patch");
		expect(getProfiledToolNames("admin")).not.toContain("pi_blitz_apply");
	});

	test("full profile preserves current all-tool surface", () => {
		expect(getProfiledToolNames("full")).toHaveLength(17);
		expect(getProfiledToolNames("full")).toContain("pi_blitz_route_edit");
		expect(getProfiledToolNames("full")).toContain("pi_blitz_apply");
		expect(getProfiledToolNames("full")).toContain("pi_blitz_doctor");
	});

	test("serialized specs omit execute functions and keep parameters", () => {
		const specs = serializeToolSpecs("blitz", process.cwd(), "minimal");
		expect(specs.profileLabel).toBe("minimal-v0");
		expect(specs.tools).toHaveLength(1);
		expect(specs.tools[0]!.name).toBe("blitz_edit");
		expect("execute" in specs.tools[0]!).toBe(false);
		expect(specs.tools[0]!.parameters).toBeTruthy();
	});

	test("minimal blitz_edit schema avoids tuple items arrays for OpenAI", () => {
		const specs = serializeToolSpecs("blitz", process.cwd(), "minimal");
		const parameters = specs.tools[0]!.parameters as Record<string, unknown>;
		const properties = parameters.properties as Record<string, unknown>;
		const eSchema = properties.e as { items?: { items?: unknown } };
		expect(Array.isArray(eSchema.items?.items)).toBe(false);
		expect(eSchema.items?.items).toBeTruthy();
	});

	test("minimal blitz_edit guidance says 3-item x requires f and prefers 4-item x", () => {
		const specs = serializeToolSpecs("blitz", process.cwd(), "minimal");
		const tool = specs.tools[0]!;
		expect(tool.description).toContain("prefer [x,file,old,new]");
		expect(tool.description).toContain("3-item [x,old,new] requires top-level f");

		const parameters = tool.parameters as Record<string, unknown>;
		const properties = parameters.properties as Record<string, unknown>;
		const eSchema = properties.e as { items?: { description?: string } };
		expect(eSchema.items?.description).toContain(
			"Prefer ['x',file,old,new]",
		);
		expect(eSchema.items?.description).toContain(
			"['x',old,new] is allowed only when top-level f is present",
		);
	});

	test("missing and empty profile resolve to minimal", () => {
		expect(resolvePiBlitzToolProfile(undefined)).toBe("minimal");
		expect(resolvePiBlitzToolProfile("")).toBe("minimal");
	});

	test("index registration defaults to minimal profile", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const { pi, registeredToolNames, resourceHandlers } = createFakePi();

		await piBlitz(pi);

		expect(registeredToolNames).toEqual(["blitz_edit"]);
		expect(resourceHandlers).toHaveLength(1);
	});

	test("bundled Blitz binary resolves from package dependency instead of PATH", () => {
		const binary = resolveBundledBlitzBinary();

		expect(binary).toContain("@codewithkenzo/blitz");
		expect(binary).toEndWith("bin/blitz.js");
		expect(existsSync(binary)).toBe(true);
	});

	test("registered minimal blitz_edit exact tuple works with bundled Blitz CLI", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const tmp = mkdtempSync(join(tmpdir(), "pi-blitz-exact-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(tmp);
			const file = join(tmp, "app.ts");
			writeFileSync(
				file,
				"export function add(a: number, b: number) {\n  return a + b\n}\n",
			);
			const { pi, registeredTools } = createFakePi();

			await piBlitz(pi);
			const tool = registeredTools.find((item) => item.name === "blitz_edit") as {
				execute: (
					tcid: string,
					params: { f: string; e: [["x", string, string]] },
				) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
			};
			const result = await tool.execute("1", {
				f: "app.ts",
				e: [["x", "return a + b", "return a + b + 1"]],
			});

			expect(result.isError).toBeUndefined();
			expect(result.content[0]?.text).toContain("ok c=1");
			expect(readFileSync(file, "utf8")).toContain("return a + b + 1");
		} finally {
			process.chdir(previousCwd);
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("minimal blitz_edit exact path edits supported-ish and plain text files", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const tmp = mkdtempSync(join(tmpdir(), "pi-blitz-exact-filetypes-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(tmp);
			const cases = [
				{ file: "app.ts", before: "export const value = 1;\n", oldText: "value = 1", newText: "value = 2" },
				{ file: "script.py", before: "value = 1\n", oldText: "value = 1", newText: "value = 2" },
				{ file: "notes.md", before: "status: draft\n", oldText: "draft", newText: "done" },
				{ file: "plain.txt", before: "status=draft\n", oldText: "draft", newText: "done" },
			] as const;
			for (const item of cases) writeFileSync(join(tmp, item.file), item.before);
			const { pi, registeredTools } = createFakePi();

			await piBlitz(pi);
			const tool = registeredTools.find((item) => item.name === "blitz_edit") as BlitzEditTool;
			for (const item of cases) {
				const result = await tool.execute("1", {
					e: [["x", item.file, item.oldText, item.newText]],
				});

				expect(result.isError).toBeUndefined();
				expect(result.content[0]?.text).toContain("ok c=1");
				expect(readFileSync(join(tmp, item.file), "utf8")).toBe(
					item.before.replace(item.oldText, item.newText),
				);
			}
		} finally {
			process.chdir(previousCwd);
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("minimal blitz_edit exact path leaves files unchanged on no-match, ambiguous, noop, and stale content", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const tmp = mkdtempSync(join(tmpdir(), "pi-blitz-exact-errors-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(tmp);
			writeFileSync(join(tmp, "no-match.ts"), "export const value = 1;\n");
			writeFileSync(join(tmp, "ambiguous.ts"), "token\ntoken\n");
			writeFileSync(join(tmp, "noop.txt"), "same\n");
			writeFileSync(join(tmp, "stale.ts"), "export const value = 2;\n");
			const { pi, registeredTools } = createFakePi();

			await piBlitz(pi);
			const tool = registeredTools.find((item) => item.name === "blitz_edit") as BlitzEditTool;
			const noMatch = await tool.execute("1", {
				f: "no-match.ts",
				e: [["x", "missing", "present"]],
			});
			const ambiguous = await tool.execute("1", {
				f: "ambiguous.ts",
				e: [["x", "token", "changed"]],
			});
			const noop = await tool.execute("1", {
				f: "noop.txt",
				e: [["x", "same", "same"]],
			});
			const stale = await tool.execute("1", {
				f: "stale.ts",
				e: [["x", "export const value = 1;", "export const value = 2;"]],
			});

			expect(noMatch.isError).toBe(true);
			expect(noMatch.content[0]?.text).toContain("NO_MATCH");
			expect(ambiguous.isError).toBe(true);
			expect(ambiguous.content[0]?.text).toContain("AMBIGUOUS_MATCH");
			expect(noop.isError).toBeUndefined();
			expect(noop.content[0]?.text).toContain("noop reason=already_present");
			expect(noop.details?.status).toBe("noop");
			expect(noop.details?.reason).toBe("already_present");
			expect(stale.isError).toBe(true);
			expect(stale.content[0]?.text).toContain("NO_MATCH");
			expect(readFileSync(join(tmp, "no-match.ts"), "utf8")).toBe("export const value = 1;\n");
			expect(readFileSync(join(tmp, "ambiguous.ts"), "utf8")).toBe("token\ntoken\n");
			expect(readFileSync(join(tmp, "noop.txt"), "utf8")).toBe("same\n");
			expect(readFileSync(join(tmp, "stale.ts"), "utf8")).toBe("export const value = 2;\n");
		} finally {
			process.chdir(previousCwd);
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("minimal blitz_edit exact path blocks symlink escape, outside absolute path, and traversal", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const tmp = mkdtempSync(join(tmpdir(), "pi-blitz-path-safety-"));
		const outside = mkdtempSync(join(tmpdir(), "pi-blitz-outside-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(tmp);
			const inside = join(tmp, "inside.ts");
			const outsideFile = join(outside, "outside.ts");
			writeFileSync(inside, "export const value = 1;\n");
			writeFileSync(outsideFile, "export const value = 1;\n");
			symlinkSync(outsideFile, join(tmp, "escape.ts"));
			const { pi, registeredTools } = createFakePi();

			await piBlitz(pi);
			const tool = registeredTools.find((item) => item.name === "blitz_edit") as BlitzEditTool;
			const attempts = [
				() => tool.execute("1", { e: [["x", "escape.ts", "value = 1", "value = 2"]] }),
				() => tool.execute("1", { e: [["x", outsideFile, "value = 1", "value = 2"]] }),
				() => tool.execute("1", { e: [["x", "../outside.ts", "value = 1", "value = 2"]] }),
			];
			for (const attempt of attempts) {
				await expect(attempt()).rejects.toThrow(/PathEscapeError|InvalidParamsError/);
			}
			expect(readFileSync(inside, "utf8")).toBe("export const value = 1;\n");
			expect(readFileSync(outsideFile, "utf8")).toBe("export const value = 1;\n");
		} finally {
			process.chdir(previousCwd);
			rmSync(tmp, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("minimal blitz_edit cross-file batch rolls back earlier mutation after later stale failure", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const tmp = mkdtempSync(join(tmpdir(), "pi-blitz-cross-file-rollback-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(tmp);
			const first = join(tmp, "first.ts");
			const second = join(tmp, "second.ts");
			const beforeFirst = "export const first = 1;\n";
			const beforeSecond = "export const second = 2;\n";
			writeFileSync(first, beforeFirst);
			writeFileSync(second, beforeSecond);
			const { pi, registeredTools } = createFakePi();

			await piBlitz(pi);
			const tool = registeredTools.find((item) => item.name === "blitz_edit") as BlitzEditTool;
			const result = await tool.execute("1", {
				e: [
					["x", "first.ts", "first = 1", "first = 10"],
					["x", "second.ts", "second = 1", "second = 10"],
				],
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("NO_MATCH");
			expect(readFileSync(first, "utf8")).toBe(beforeFirst);
			expect(readFileSync(second, "utf8")).toBe(beforeSecond);
		} finally {
			process.chdir(previousCwd);
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("minimal blitz_edit declines structural rb without mutating TS", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const tmp = mkdtempSync(join(tmpdir(), "pi-blitz-rb-decline-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(tmp);
			const file = join(tmp, "app.ts");
			const before = "export function add(a: number, b: number) {\n  return a + b\n}\n";
			writeFileSync(file, before);
			const { pi, registeredTools } = createFakePi();

			await piBlitz(pi);
			const tool = registeredTools.find((item) => item.name === "blitz_edit") as {
				execute: (
					tcid: string,
					params: { e: [["rb", string, string, string, string]] },
				) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
			};
			const result = await tool.execute("1", {
				e: [["rb", "app.ts", "function", "add", "return a - b"]],
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("decline op=rb");
			expect(result.content[0]?.text).toContain("unsupported_structural_op_minimal");
			expect(result.content[0]?.text).not.toContain("MISSING_FIELD");
			expect(result.content[0]?.text).not.toContain("ok");
			expect(readFileSync(file, "utf8")).toBe(before);
		} finally {
			process.chdir(previousCwd);
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("minimal blitz_edit declines structural ia without mutating Python", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const tmp = mkdtempSync(join(tmpdir(), "pi-blitz-ia-decline-"));
		const previousCwd = process.cwd();
		try {
			process.chdir(tmp);
			const file = join(tmp, "app.py");
			const before = "def add(a, b):\n    return a + b\n";
			writeFileSync(file, before);
			const { pi, registeredTools } = createFakePi();

			await piBlitz(pi);
			const tool = registeredTools.find((item) => item.name === "blitz_edit") as {
				execute: (
					tcid: string,
					params: { e: [["ia", string, string, string, string]] },
				) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
			};
			const result = await tool.execute("1", {
				e: [["ia", "app.py", "function", "add", "def sub(a, b):\n    return a - b"]],
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("decline op=ia");
			expect(result.content[0]?.text).toContain("unsupported_structural_op_minimal");
			expect(result.content[0]?.text).not.toContain("MISSING_FIELD");
			expect(result.content[0]?.text).not.toContain("ok");
			expect(readFileSync(file, "utf8")).toBe(before);
		} finally {
			process.chdir(previousCwd);
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("index registration honors explicit full profile", async () => {
		process.env.PI_BLITZ_TOOL_PROFILE = "full";
		const { pi, registeredToolNames } = createFakePi();

		await piBlitz(pi);

		expect(registeredToolNames).toHaveLength(17);
		expect(registeredToolNames).toContain("pi_blitz_route_edit");
		expect(registeredToolNames).toContain("pi_blitz_apply");
		expect(registeredToolNames).toContain("pi_blitz_doctor");
	});

	test("invalid profile fails closed", () => {
		expect(() => resolvePiBlitzToolProfile("bad")).toThrow(
			/invalid PI_BLITZ_TOOL_PROFILE/,
		);
	});
});
