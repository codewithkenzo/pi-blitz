import type { Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { PiBlitzDetails } from "./tool-runtime.js";

interface TextResultLike {
	content: Array<{ type: string; text?: string }>;
	details?: unknown;
	isError?: boolean;
}

const ellipsize = (value: string, max: number): string => {
	if (value.length <= max) return value;
	if (max <= 1) return "…";
	return `${value.slice(0, max - 1)}…`;
};

const firstText = (result: TextResultLike): string => {
	const first = result.content[0];
	return first?.type === "text" ? first.text ?? "" : "";
};

const summarize = (result: TextResultLike, fallback = "no output"): string => {
	const details = result.details as PiBlitzDetails | undefined;
	if (details?.summary !== undefined && details.summary.trim().length > 0) {
		return ellipsize(details.summary.replace(/\s+/g, " ").trim(), 84);
	}
	const text = firstText(result).replace(/\s+/g, " ").trim();
	return text.length > 0 ? ellipsize(text, 84) : fallback;
};

const opFromArgs = (args: unknown): string => {
	if (args === null || typeof args !== "object") return "blitz";
	const record = args as Record<string, unknown>;
	if (typeof record.operation === "string") return record.operation;
	if (typeof record.symbol === "string") return record.symbol;
	if (Array.isArray(record.ops)) return `${record.ops.length} ops`;
	if (Array.isArray(record.edits)) return `${record.edits.length} edits`;
	if (typeof record.file === "string") return record.file;
	return "blitz";
};

const fileFromArgs = (args: unknown): string | undefined => {
	if (args === null || typeof args !== "object") return undefined;
	const file = (args as Record<string, unknown>).file;
	return typeof file === "string" ? file : undefined;
};

const formatDuration = (ms: number): string => {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${Math.round(ms / 100) / 10}s`;
};

export const renderBlitzCall = (args: unknown, theme: Theme, _context?: unknown): Text => {
	const file = fileFromArgs(args);
	const op = opFromArgs(args);
	const parts = [
		theme.fg("toolTitle", theme.bold("blitz")),
		theme.fg("accent", ellipsize(op, 36)),
		file !== undefined ? theme.fg("muted", ellipsize(file, 48)) : "",
	].filter(Boolean);
	return new Text(parts.join(theme.fg("muted", " · ")), 0, 0);
};

export const renderBlitzResult = (
	result: TextResultLike,
	options: { isPartial?: boolean },
	theme: Theme,
	_context?: unknown,
): Text => {
	const details = result.details as PiBlitzDetails | undefined;
	const partial = options.isPartial === true || details?.status === "running";
	const failed = result.isError === true || details?.status === "failed";
	const icon = partial ? theme.fg("warning", "◌") : failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
	const op = details?.opLabel ?? details?.operation ?? "blitz";
	const file = details?.pathLabel ?? details?.file;
	const change = details?.changeLabel;
	const duration = details?.durationMs ?? details?.wallMs;
	const pieces = [
		icon,
		theme.fg(failed ? "error" : "accent", "blitz"),
		theme.fg("muted", ellipsize(op, 36)),
		file !== undefined ? theme.fg("muted", ellipsize(file, 44)) : "",
		change !== undefined ? theme.fg("muted", change) : "",
		duration !== undefined ? theme.fg("muted", formatDuration(duration)) : "",
	]
		.filter(Boolean)
		.join(theme.fg("muted", " · "));
	return new Text(`${pieces}${theme.fg("muted", " — ")}${theme.fg("toolOutput", summarize(result))}`, 0, 0);
};

export const blitzRenderers = {
	renderCall: renderBlitzCall,
	renderResult: renderBlitzResult,
};
