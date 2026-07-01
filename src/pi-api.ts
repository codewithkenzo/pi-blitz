export type PiToolDef = {
	name: string;
	label?: string;
	description?: string;
	parameters?: unknown;
	execute?: unknown;
};

export type ExtensionAPI = {
	registerTool(tool: PiToolDef): void;
	on(event: "resources_discover", handler: () => { skillPaths: string[] }): void;
};
