import { Effect, Exit, Cause } from "effect";
import type { PiBlitzError } from "./errors.js";

export interface PiBlitzDetails {
	reason?: string;
	suggest?: string;
	warning?: string;
	partial?: boolean;
	degraded?: boolean;
	status?: string;
	parseFallback?: boolean;
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
			const details: PiBlitzDetails = { reason: err.reason };
			if (err.suggest !== undefined) details.suggest = err.suggest;
			return {
				content: [{ type: "text" as const, text: renderSoftText(err) }],
				isError: true,
				details,
			};
		}
		throw new Error(`${err._tag}: ${renderHardText(err)}`);
	}

	throw new Error(`pi-blitz failed: ${Cause.pretty(exit.cause)}`);
};

const renderSoftText = (err: Extract<PiBlitzError, { _tag: "BlitzSoftError" }>): string => {
	const suggest = err.suggest ? `\nsuggest: ${err.suggest}` : "";
	return `pi-blitz ${err.reason}: ${err.stderr.trim()}${suggest}`;
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
