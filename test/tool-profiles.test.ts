/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
