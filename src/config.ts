import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const PiBlitzConfigSchema = Type.Object({
	binary: Type.Optional(Type.String({ minLength: 1 })),
});
export type PiBlitzConfig = Static<typeof PiBlitzConfigSchema>;

const USER_ONLY_KEYS = new Set<keyof PiBlitzConfig>(["binary"]);

const CONFIG_FILE = "pi-blitz.json";

/**
 * Load pi-blitz config with user/project precedence.
 *
 * Project-level `./.pi/pi-blitz.json` keys override user-level except for
 * USER_ONLY_KEYS which can only be set at ~/.pi/pi-blitz.json.
 */
export const loadConfig = (cwd: string): PiBlitzConfig => {
	const userPath = join(homedir(), ".pi", CONFIG_FILE);
	const projectPath = join(cwd, ".pi", CONFIG_FILE);

	const userConfig = readAndValidate(userPath) ?? {};
	const projectConfig = readAndValidate(projectPath) ?? {};

	// Strip USER_ONLY_KEYS from projectConfig.
	const safeProject: PiBlitzConfig = {};
	for (const [k, v] of Object.entries(projectConfig) as [keyof PiBlitzConfig, unknown][]) {
		if (USER_ONLY_KEYS.has(k)) continue;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- index assignment across schema keys
		(safeProject as Record<string, unknown>)[k] = v;
	}

	return { ...userConfig, ...safeProject };
};

const readAndValidate = (path: string): PiBlitzConfig | undefined => {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!Value.Check(PiBlitzConfigSchema, parsed)) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
};

export const configHash = (cfg: PiBlitzConfig): string => {
	// Stable JSON for cache key. Keys sorted alphabetically.
	const keys = Object.keys(cfg).sort();
	const sorted: Record<string, unknown> = {};
	for (const k of keys) {
		sorted[k] = (cfg as Record<string, unknown>)[k];
	}
	return JSON.stringify(sorted);
};
