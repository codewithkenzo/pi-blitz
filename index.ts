import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./src/config.js";
import {
	getProfiledToolDefs,
	resolvePiBlitzToolProfile,
} from "./src/tool-profiles.js";

const baseDir = dirname(fileURLToPath(import.meta.url));
const requireFromExtension = createRequire(import.meta.url);

export const resolveBundledBlitzBinary = (): string => {
	if (process.env.BLITZ_BIN) return process.env.BLITZ_BIN;
	try {
		return requireFromExtension.resolve("@codewithkenzo/blitz/bin/blitz.js");
	} catch {
		return "blitz";
	}
};

type PiBlitzState = {
	registered: boolean;
	skillsAnnounced: boolean;
};

const states = new WeakMap<ExtensionAPI, PiBlitzState>();

export default async function piBlitz(pi: ExtensionAPI): Promise<void> {
	const state = states.get(pi) ?? { registered: false, skillsAnnounced: false };
	if (state.registered) {
		console.warn("[pi-blitz] already initialized for this API instance; skipping.");
		return;
	}

	const cwd = typeof process.cwd === "function" ? process.cwd() : baseDir;
	const config = loadConfig(cwd);
	const binary = config.binary ?? resolveBundledBlitzBinary();
	const profile = resolvePiBlitzToolProfile(process.env.PI_BLITZ_TOOL_PROFILE);

	for (const tool of getProfiledToolDefs(binary, cwd, profile)) {
		pi.registerTool(tool);
	}

	if (!state.skillsAnnounced) {
		const sourceSkillDir = join(baseDir, "skills", "pi-blitz");
		const bundledSkillDir = join(dirname(baseDir), "skills", "pi-blitz");
		const skillDir = existsSync(sourceSkillDir) ? sourceSkillDir : bundledSkillDir;
		pi.on("resources_discover", () => ({ skillPaths: [skillDir] }));
		state.skillsAnnounced = true;
	}

	state.registered = true;
	states.set(pi, state);
}
