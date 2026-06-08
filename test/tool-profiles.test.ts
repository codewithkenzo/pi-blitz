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
	test("minimal profile is minimal-v0 and registers only compact existing patch surface", () => {
		expect(profileLabel("minimal")).toBe("minimal-v0");
		expect(getProfiledToolNames("minimal")).toEqual(["pi_blitz_patch"]);
	});

	test("semantic profile omits structural/admin schemas", () => {
		expect(getProfiledToolNames("semantic")).toEqual([
			"pi_blitz_patch",
			"pi_blitz_try_catch",
			"pi_blitz_replace_return",
		]);
		expect(getProfiledToolNames("semantic")).not.toContain("pi_blitz_read");
		expect(getProfiledToolNames("semantic")).not.toContain("pi_blitz_apply");
	});

	test("structural profile exposes narrow edit tools without legacy/full/admin tools", () => {
		expect(getProfiledToolNames("structural")).toEqual([
			"pi_blitz_replace_body_span",
			"pi_blitz_insert_body_span",
			"pi_blitz_wrap_body",
			"pi_blitz_compose_body",
			"pi_blitz_multi_body",
			"pi_blitz_patch",
		]);
		expect(getProfiledToolNames("structural")).not.toContain("pi_blitz_doctor");
		expect(getProfiledToolNames("structural")).not.toContain("pi_blitz_edit");
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

	test("full profile preserves current 15-tool surface", () => {
		expect(getProfiledToolNames("full")).toHaveLength(15);
		expect(getProfiledToolNames("full")).toContain("pi_blitz_apply");
		expect(getProfiledToolNames("full")).toContain("pi_blitz_doctor");
	});

	test("serialized specs omit execute functions and keep parameters", () => {
		const specs = serializeToolSpecs("blitz", process.cwd(), "minimal");
		expect(specs.profileLabel).toBe("minimal-v0");
		expect(specs.tools).toHaveLength(1);
		expect(specs.tools[0]!.name).toBe("pi_blitz_patch");
		expect("execute" in specs.tools[0]!).toBe(false);
		expect(specs.tools[0]!.parameters).toBeTruthy();
	});

	test("missing and empty profile resolve to minimal", () => {
		expect(resolvePiBlitzToolProfile(undefined)).toBe("minimal");
		expect(resolvePiBlitzToolProfile("")).toBe("minimal");
	});

	test("index registration defaults to minimal profile", async () => {
		delete process.env.PI_BLITZ_TOOL_PROFILE;
		const { pi, registeredToolNames, resourceHandlers } = createFakePi();

		await piBlitz(pi);

		expect(registeredToolNames).toEqual(["pi_blitz_patch"]);
		expect(resourceHandlers).toHaveLength(1);
	});

	test("index registration honors explicit full profile", async () => {
		process.env.PI_BLITZ_TOOL_PROFILE = "full";
		const { pi, registeredToolNames } = createFakePi();

		await piBlitz(pi);

		expect(registeredToolNames).toHaveLength(15);
		expect(registeredToolNames).toContain("pi_blitz_apply");
		expect(registeredToolNames).toContain("pi_blitz_doctor");
	});

	test("invalid profile fails closed", () => {
		expect(() => resolvePiBlitzToolProfile("bad")).toThrow(
			/invalid PI_BLITZ_TOOL_PROFILE/,
		);
	});
});
