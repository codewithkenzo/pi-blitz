#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { serializeToolSpecs } from "../src/tool-profiles.js";
import {
	minimalBlitzEditDeclineText,
	minimalBlitzEditSuccessText,
} from "../src/tools.js";

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

const minimalSchema = JSON.stringify(serializeToolSpecs("blitz", ".", "minimal"));
const residentSkill = readFileSync("skills/pi-blitz/SKILL.md", "utf8");
const successOutput = minimalBlitzEditSuccessText(1, 1, false);
const declineOutput = minimalBlitzEditDeclineText("rb");

const guards = [
	{
		id: "minimal-schema",
		bytes: byteLength(minimalSchema),
		maxBytes: 666,
		note: "Serialized minimal blitz_edit tool spec. Sprint G tiny-exact floor after schema wording trim.",
	},
	{
		id: "resident-skill",
		bytes: byteLength(residentSkill),
		maxBytes: 713,
		note: "Packaged skills/pi-blitz/SKILL.md resident text after Sprint G safety-preserving trim.",
	},
	{
		id: "success-output",
		bytes: byteLength(successOutput),
		maxBytes: 32,
		note: "Representative minimal success content text; public parseable ok c=N shape preserved.",
	},
	{
		id: "decline-output",
		bytes: byteLength(declineOutput),
		maxBytes: 80,
		note: "Representative fail-closed structural decline content text; no_mutation marker preserved.",
	},
] as const;

const failures = guards.filter((guard) => guard.bytes > guard.maxBytes);

console.log(JSON.stringify({ status: failures.length === 0 ? "ok" : "fail", guards }, null, 2));

if (failures.length > 0) {
	console.error(
		`tax guard failed: ${failures
			.map((guard) => `${guard.id} ${guard.bytes}>${guard.maxBytes}`)
			.join(", ")}`,
	);
	process.exit(1);
}
