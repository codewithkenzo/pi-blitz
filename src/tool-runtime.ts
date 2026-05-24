import { Effect, Exit, Cause } from "effect";
import type { PiBlitzError } from "./errors.js";

export interface PiBlitzDetails {
	reason?: string;
	suggest?: string;
	warning?: string;
	partial?: boolean;
	degraded?: boolean;
	status?: string;
	code?: string;
	parseFallback?: boolean;
	lane?: string;
	mode?: string;
	language?: string;
	file?: string;
	fileBytesBefore?: number;
	fileBytesAfter?: number;
	symbolBytesBefore?: number;
	symbolBytesAfter?: number;
	snippetBytes?: number;
	blitzPayloadBytes?: number;
	coreFullSymbolPayloadBytes?: number;
	coreRealisticAnchorPayloadBytes?: number;
	coreMinimalAnchorPayloadBytes?: number;
	estimatedPayloadSavedBytesVsFullSymbol?: number;
	estimatedPayloadSavedPctVsFullSymbol?: number;
	estimatedPayloadSavedBytesVsRealisticAnchor?: number;
	estimatedPayloadSavedPctVsRealisticAnchor?: number;
	estimatedTokensSavedBytesDiv4VsRealisticAnchor?: number;
	estimatedPayloadSavedBytesVsMinimalAnchor?: number;
	estimatedPayloadSavedPctVsMinimalAnchor?: number;
	estimatedTokensSavedBytesDiv4VsMinimalAnchor?: number;
	realisticContextLines?: number;
	usedMarkers?: boolean;
	wallMs?: number;
	pathLabel?: string;
	opLabel?: string;
	changeLabel?: string;
	durationMs?: number;
	savingsPct?: number;
	ranges?: unknown;
	diffSummary?: unknown;
	validation?: unknown;
	metrics?: unknown;
	operation?: string;
	summary?: string;
}

export interface BlitzToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: PiBlitzDetails | undefined;
	isError?: boolean;
}

/**
 * Boundary runner: converts an Effect<A, PiBlitzError> into a Promise<BlitzToolResult>.
 *
 * - Success → `serialize(value)`.
 * - `BlitzSoftError` → `{ isError: true, details: { reason, suggest } }`.
 * - Anything else → throw, so pi-mono reports it as a hard failure.
 *
 * `Cause.findErrorOption` is the correct extractor in effect@4.0.0-beta.48;
 * `Cause.failureOption` does not exist in v4.
 */
export const runTool = async <A>(
	effect: Effect.Effect<A, PiBlitzError>,
	serialize: (value: A) => BlitzToolResult,
): Promise<BlitzToolResult> => {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return serialize(exit.value);

	const errOpt = Cause.findErrorOption(exit.cause);
	if (errOpt._tag === "Some") {
		const err = errOpt.value;
		if (err._tag === "BlitzSoftError") {
			const detailText = renderSoftText(err);
			const summaryParts = [formatSoftReason(err.reason)];
			if (err.status !== undefined) summaryParts.push(`status=${err.status}`);
			if (err.code !== undefined) summaryParts.push(`code=${err.code}`);
			const details: PiBlitzDetails = { reason: err.reason, summary: summaryParts.join(" · ") };
			if (err.suggest !== undefined) details.suggest = err.suggest;
			if (err.status !== undefined) details.status = err.status;
			if (err.code !== undefined) details.code = err.code;
			return {
				content: [{ type: "text" as const, text: detailText }],
				isError: true,
				details,
			};
		}
		throw new Error(`${err._tag}: ${renderHardText(err)}`);
	}

	throw new Error(`pi-blitz failed: ${Cause.pretty(exit.cause)}`);
};

const SOFT_LINE_MAX = 200;
const SOFT_TEXT_MAX = 350;

const clamp = (text: string, maxChars: number): string => {
	if (text.length <= maxChars) return text;
	if (maxChars <= 3) return text.slice(0, maxChars);
	return `${text.slice(0, maxChars - 3)}...`;
};

const formatSoftReason = (reason: string): string => {
	switch (reason) {
		case "no-undo-history":
			return "undo history missing";
		case "no-occurrences":
			return "symbol not found";
		case "no-references":
			return "no references";
		case "no-backup":
			return "no backup";
		case "no-changes":
			return "no changes";
		case "empty-results":
			return "no matches";
		case "apply-rejected":
			return "apply rejected";
		default:
			return "blitz miss";
	}
};

const renderSoftText = (err: Extract<PiBlitzError, { _tag: "BlitzSoftError" }>): string => {
	const firstLine = (err.stderr ?? "").split(/\r?\n/)[0]?.trim() ?? "";
	const lines: string[] = [`blitz miss: ${formatSoftReason(err.reason)}`];
	if (err.status !== undefined) lines.push(`status: ${err.status}`);
	if (err.code !== undefined) lines.push(`code: ${err.code}`);
	if (firstLine.length > 0) lines.push(`detail: ${clamp(firstLine, SOFT_LINE_MAX)}`);
	if (err.suggest !== undefined) lines.push(`next: ${err.suggest}`);
	return clamp(lines.join("\n"), SOFT_TEXT_MAX);
};

const renderHardText = (err: PiBlitzError): string => {
	switch (err._tag) {
		case "InvalidParamsError":
			return err.reason;
		case "ConfirmRequiredError":
			return `'${err.tool}' requires confirm: true`;
		case "BlitzTimeoutError":
			return `'${err.command}' timed out after ${err.timeoutMs}ms`;
		case "BlitzMissingError":
			return `'${err.binary}' not found. Install blitz and retry.`;
		case "BlitzVersionError":
			return `blitz version ${err.found} below required ${err.required}`;
		case "PathEscapeError":
			return `path '${err.path}' escapes workspace '${err.cwd}'`;
		case "BlitzSoftError":
			return err.stderr.trim();
	}
};
