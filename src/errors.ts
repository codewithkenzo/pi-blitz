import { Data } from "effect";

export class InvalidParamsError extends Data.TaggedError("InvalidParamsError")<{
	readonly reason: string;
}> {}

export class ConfirmRequiredError extends Data.TaggedError("ConfirmRequiredError")<{
	readonly tool: string;
}> {}

export class BlitzTimeoutError extends Data.TaggedError("BlitzTimeoutError")<{
	readonly command: string;
	readonly timeoutMs: number;
}> {}

export class BlitzMissingError extends Data.TaggedError("BlitzMissingError")<{
	readonly binary: string;
}> {}

export class BlitzVersionError extends Data.TaggedError("BlitzVersionError")<{
	readonly found: string;
	readonly required: string;
}> {}

export class PathEscapeError extends Data.TaggedError("PathEscapeError")<{
	readonly path: string;
	readonly cwd: string;
}> {}

export type BlitzSoftReason =
	| "no-undo-history"
	| "no-occurrences"
	| "no-references"
	| "no-backup"
	| "no-changes"
	| "empty-results"
	| "blitz-error";

export class BlitzSoftError extends Data.TaggedError("BlitzSoftError")<{
	readonly reason: BlitzSoftReason;
	readonly stderr: string;
	readonly suggest?: string;
}> {}

export type PiBlitzError =
	| InvalidParamsError
	| ConfirmRequiredError
	| BlitzTimeoutError
	| BlitzMissingError
	| BlitzVersionError
	| PathEscapeError
	| BlitzSoftError;
