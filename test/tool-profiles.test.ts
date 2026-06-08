/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
	getProfiledToolNames,
	profileLabel,
	resolvePiBlitzToolProfile,
	serializeToolSpecs,
} from "../src/tool-profiles.js";

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

	test("invalid profile fails closed", () => {
		expect(() => resolvePiBlitzToolProfile("bad")).toThrow(/invalid PI_BLITZ_TOOL_PROFILE/);
	});
});
