#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	PI_BLITZ_TOOL_PROFILES,
	resolvePiBlitzToolProfile,
	serializeToolSpecs,
} from "../src/tool-profiles.js";

const args = process.argv.slice(2);
const arg = (name: string, fallback = "") => {
	const idx = args.findIndex((item) => item === name || item.startsWith(`${name}=`));
	if (idx < 0) return fallback;
	const item = args[idx]!;
	return item.includes("=") ? item.split("=")[1]! : args[idx + 1] ?? fallback;
};

const profileArg = arg("--profile", process.env.PI_BLITZ_TOOL_PROFILE ?? "full");
const out = arg("--out", "");
const cwd = resolve(arg("--cwd", process.cwd()));
const binary = arg("--binary", process.env.BLITZ_BIN ?? "blitz");

if (profileArg === "all") {
	const payload = {
		generatedAt: new Date().toISOString(),
		profiles: PI_BLITZ_TOOL_PROFILES.map((profile) => serializeToolSpecs(binary, cwd, profile)),
	};
	const text = JSON.stringify(payload, null, 2);
	if (out) await writeFile(out, text);
	else console.log(text);
} else {
	const profile = resolvePiBlitzToolProfile(profileArg);
	const payload = { generatedAt: new Date().toISOString(), ...serializeToolSpecs(binary, cwd, profile) };
	const text = JSON.stringify(payload, null, 2);
	if (out) await writeFile(out, text);
	else console.log(text);
}
