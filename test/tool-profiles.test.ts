/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test";
import piBlitz from "../index.js";
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
	const resourceHandlers: Array<() => { skillPaths: string[] }> = [];
	const pi = {
		registerTool(tool: { name: string }) {
			registeredToolNames.push(tool.name);
		},
		on(event: string, handler: () => { skillPaths: string[] }) {
			if (event === "resources_discover") resourceHandlers.push(handler);
		},
	} as Parameters<typeof piBlitz>[0];

	return { pi, registeredToolNames, resourceHandlers };
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
		expect(getProfiledToolNames("structural")).not.toContain("pi_blitz_wrap_body");
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
