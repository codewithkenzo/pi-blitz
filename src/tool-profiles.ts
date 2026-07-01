import type { PiToolDef } from "./pi-api.js";
import {
	batchToolDef,
	blitzEditToolDef,
	composeBodyToolDef,
	doctorToolDef,
	editToolDef,
	insertBodySpanToolDef,
	multiBodyToolDef,
	opToolDef,
	patchToolDef,
	piBlitzApplyToolDef,
	readToolDef,
	renameToolDef,
	replaceBodySpanToolDef,
	replaceReturnToolDef,
	routeEditToolDef,
	tryCatchToolDef,
	undoToolDef,
	wrapBodyToolDef,
} from "./tools.js";

export type PiBlitzToolProfile = "minimal" | "router" | "semantic" | "structural" | "admin" | "full";
export type PiBlitzProfileLabel = PiBlitzToolProfile | "minimal-v0";

type ToolFactory = (binary: string, cwd: string) => PiToolDef;

const PROFILE_TOOLS = {
	minimal: [blitzEditToolDef],
	router: [routeEditToolDef],
	semantic: [opToolDef, patchToolDef, tryCatchToolDef, replaceReturnToolDef],
	structural: [opToolDef, replaceBodySpanToolDef, multiBodyToolDef, patchToolDef],
	admin: [readToolDef, renameToolDef, undoToolDef, doctorToolDef],
	full: [
		routeEditToolDef,
		opToolDef,
		readToolDef,
		editToolDef,
		batchToolDef,
		piBlitzApplyToolDef,
		replaceBodySpanToolDef,
		insertBodySpanToolDef,
		wrapBodyToolDef,
		composeBodyToolDef,
		multiBodyToolDef,
		patchToolDef,
		tryCatchToolDef,
		replaceReturnToolDef,
		renameToolDef,
		undoToolDef,
		doctorToolDef,
	],
} satisfies Record<PiBlitzToolProfile, ToolFactory[]>;

export const PI_BLITZ_TOOL_PROFILES = Object.keys(PROFILE_TOOLS) as PiBlitzToolProfile[];

export const resolvePiBlitzToolProfile = (value: string | undefined): PiBlitzToolProfile => {
	if (value === undefined || value === "") return "minimal";
	if (PI_BLITZ_TOOL_PROFILES.includes(value as PiBlitzToolProfile)) return value as PiBlitzToolProfile;
	throw new Error(`invalid PI_BLITZ_TOOL_PROFILE=${value}; expected ${PI_BLITZ_TOOL_PROFILES.join("|")}`);
};

export const profileLabel = (profile: PiBlitzToolProfile): PiBlitzProfileLabel =>
	profile === "minimal" ? "minimal-v0" : profile;

export const getProfiledToolDefs = (binary: string, cwd: string, profile: PiBlitzToolProfile): PiToolDef[] =>
	PROFILE_TOOLS[profile].map((factory) => factory(binary, cwd));

export const getProfiledToolNames = (profile: PiBlitzToolProfile): string[] =>
	PROFILE_TOOLS[profile].map((factory) => factory("blitz", ".").name);

export const serializeToolSpecs = (binary: string, cwd: string, profile: PiBlitzToolProfile) => ({
	profile,
	profileLabel: profileLabel(profile),
	tools: getProfiledToolDefs(binary, cwd, profile).map((tool) => ({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
	})),
});
