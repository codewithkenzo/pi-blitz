import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./src/config.js";
import {
	batchToolDef,
	doctorToolDef,
	editToolDef,
	readToolDef,
	renameToolDef,
	undoToolDef,
} from "./src/tools.js";

const baseDir = dirname(fileURLToPath(import.meta.url));

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
	const binary = config.binary ?? "blitz";

	pi.registerTool(readToolDef(binary, cwd));
	pi.registerTool(editToolDef(binary, cwd));
	pi.registerTool(batchToolDef(binary, cwd));
	pi.registerTool(renameToolDef(binary, cwd));
	pi.registerTool(undoToolDef(binary, cwd));
	pi.registerTool(doctorToolDef(binary, cwd));

	if (!state.skillsAnnounced) {
		const skillDir = join(baseDir, "skills", "pi-blitz");
		pi.on("resources_discover", () => ({ skillPaths: [skillDir] }));
		state.skillsAnnounced = true;
	}

	state.registered = true;
	states.set(pi, state);
}
