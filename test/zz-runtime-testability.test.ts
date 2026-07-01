/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { BlitzMissingError, BlitzSoftError } from "../src/errors.js";
import { runTool } from "../src/tool-runtime.js";

describe("pi-blitz Effect runtime classification", () => {
	test("runTool classifies BlitzSoftError as tool error result", async () => {
		const result = await runTool(
			Effect.fail(
				new BlitzSoftError({
					reason: "blitz-error",
					stderr: "NO_MATCH anchor",
					suggest: "fallback to core edit",
				}),
			),
			() => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
		);

		expect(result.isError).toBe(true);
		expect(result.details?.reason).toBe("blitz-error");
		expect(result.details?.suggest).toBe("fallback to core edit");
		expect(result.content[0]?.text).toContain("pi-blitz blitz-error: NO_MATCH anchor");
	});

	test("runTool classifies hard errors as thrown failures", async () => {
		await expect(
			runTool(
				Effect.fail(new BlitzMissingError({ binary: "blitz" })),
				() => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
			),
		).rejects.toThrow("BlitzMissingError: 'blitz' not found. Install blitz and retry.");
	});
});
