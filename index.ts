import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./src/config.js";
import {
	batchToolDef,
	composeBodyToolDef,
	doctorToolDef,
	editToolDef,
	insertBodySpanToolDef,
	multiBodyToolDef,
	patchToolDef,
	tryCatchToolDef,
	replaceReturnToolDef,
	piBlitzApplyToolDef,
	readToolDef,
	replaceBodySpanToolDef,
	wrapBodyToolDef,
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
	pi.registerTool(piBlitzApplyToolDef(binary, cwd));
	pi.registerTool(replaceBodySpanToolDef(binary, cwd));
	pi.registerTool(insertBodySpanToolDef(binary, cwd));
	pi.registerTool(wrapBodyToolDef(binary, cwd));
	pi.registerTool(composeBodyToolDef(binary, cwd));
	pi.registerTool(multiBodyToolDef(binary, cwd));
	pi.registerTool(patchToolDef(binary, cwd));
	pi.registerTool(tryCatchToolDef(binary, cwd));
	pi.registerTool(replaceReturnToolDef(binary, cwd));
	pi.registerTool(renameToolDef(binary, cwd));
	pi.registerTool(undoToolDef(binary, cwd));
	pi.registerTool(doctorToolDef(binary, cwd));

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
