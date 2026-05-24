import { Type } from "@sinclair/typebox";
import type { AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import { Effect } from "effect";
import { spawnCollectNode } from "./spawn.js";
import { canonicalize } from "./paths.js";
import { blitzRenderers } from "./renderers.js";
import { runTool, type BlitzToolResult, type PiBlitzDetails } from "./tool-runtime.js";
import { makePathLocks } from "./mutex.js";
import {
	BlitzMissingError,
	BlitzSoftError,
	BlitzTimeoutError,
	InvalidParamsError,
} from "./errors.js";

// Module-level locks shared across all tool definitions so concurrent tool calls
// targeting the same canonical path serialize.
const locks = makePathLocks();

const PATH_MAX = 4096;
const SNIPPET_MAX = 65_536;
const BATCH_MAX_ITEMS = 64;
const BATCH_MAX_AGGREGATE = 256 * 1024;
const APPLY_MAX_PAYLOAD = 512 * 1024;
const UPDATE_TEXT_MAX = 120;

type ToolProgressUpdate = AgentToolUpdateCallback<PiBlitzDetails | undefined>;

const emitBlitzUpdate = async (
	onUpdate: ToolProgressUpdate | undefined,
	summary: string,
	details: PiBlitzDetails | undefined,
): Promise<void> => {
	if (typeof onUpdate !== "function") return;
	const text = summary.trim();
	if (text.length === 0) return;
	const truncated = text.length <= UPDATE_TEXT_MAX
		? text
		: `${text.slice(0, UPDATE_TEXT_MAX - 3)}...`;
	try {
		await onUpdate({
			content: [{ type: "text", text: truncated }],
			details,
		});
	} catch {
		return;
	}
};

const runWithProgress = async <T>(
	onUpdate: ToolProgressUpdate | undefined,
	runningSummary: string,
	doneSummary: string,
	runningDetails: PiBlitzDetails | undefined,
	operationResult: () => Promise<T>,
): Promise<T> => {
	await emitBlitzUpdate(onUpdate, runningSummary, runningDetails);
	try {
		const result = await operationResult();
		await emitBlitzUpdate(onUpdate, doneSummary, {
			...runningDetails,
			status: "done",
		});
		return result;
	} catch (error) {
		await emitBlitzUpdate(onUpdate, "blitz: failed", {
			...runningDetails,
			status: "failed",
			summary: "blitz: failed",
		});
		throw error;
	}
};

const pathSchema = Type.String({ minLength: 1, maxLength: PATH_MAX, description: "Absolute or repo-relative path to the source file." });
const snippetSchema = Type.String({
	minLength: 1,
	maxLength: SNIPPET_MAX,
	description:
		"Replacement code body. May include `// ... existing code ...` (or `# ...` for Python) to preserve unchanged regions. NOT a diff or oldText/newText pair — just the new body.",
});
const replaceSymbolSchema = Type.String({
	minLength: 1,
	maxLength: 512,
	description:
		"Name of the function/class/method/variable whose body to replace. Must be the SYMBOL NAME only (e.g. \"handleRequest\"), never source code or text.",
});
const afterSymbolSchema = Type.String({
	minLength: 1,
	maxLength: 512,
	description:
		"Name of the function/class/method/variable to insert AFTER. Must be the SYMBOL NAME only (e.g. \"handleRequest\"), never source code or text.",
});
const renameSymbolSchema = Type.String({ minLength: 1, maxLength: 512, description: "Identifier name (no surrounding code)." });
const applyOperationSchema = Type.Union(
	[
		Type.Literal("replace_body_span"),
		Type.Literal("insert_body_span"),
		Type.Literal("wrap_body"),
		Type.Literal("compose_body"),
		Type.Literal("multi_body"),
		Type.Literal("insert_after_symbol"),
		Type.Literal("set_body"),
		Type.Literal("patch"),
	],
	{
		description:
			"Structured edit operation. Prefer one of: replace_body_span, insert_body_span, wrap_body, compose_body, multi_body, insert_after_symbol, set_body, patch.",
	},
);

const applyTargetSchema = Type.Object(
	{
		symbol: Type.String({
			minLength: 1,
			maxLength: 512,
			description:
				"Target symbol name (declaration, not call-site). No surrounding text or code.",
		}),
		kind: Type.Optional(
			Type.Union(
				[
					Type.Literal("function"),
					Type.Literal("method"),
					Type.Literal("class"),
					Type.Literal("variable"),
					Type.Literal("type"),
				],
				{ description: "Expected AST kind hint; narrows candidate selection." },
			),
		),
		range: Type.Optional(
			Type.Union(
				[
					Type.Literal("body"),
					Type.Literal("node"),
				],
				{ description: "Mutate body (default) or full declaration node range." },
			),
		),
	},
	{ description: "Symbol target object for apply command." },
);

const applyEditSchema = Type.Record(
	Type.String({ minLength: 1, maxLength: 64 }),
	Type.Unknown(),
	{
		description:
			"Operation-specific payload. Use only keys defined per operation docs. Unknown keys rejected by runtime checks during execution.",
	},
);

const applyOptionsSchema = Type.Object(
	{
		dryRun: Type.Optional(
			Type.Boolean({
				description:
					"Set true for no-write dry run. If true, tool still performs target matching and edit validation.",
			}),
		),
		includeDiff: Type.Optional(
			Type.Boolean({
				description: "Set true to request compact diff summary from CLI output.",
			}),
		),
		diffContext: Type.Optional(
			Type.Number({
				minimum: 0,
				maximum: 24,
				description: "Unified diff context lines when includeDiff/include_diff is set. Defaults to 12.",
			}),
		),
	},
	{ additionalProperties: false },
);

const patchOpValueSchema = Type.Union([Type.String({ maxLength: SNIPPET_MAX }), Type.Number()], {
	description: "Patch tuple item. Ops: ['replace',symbol,find,replace,occurrence?], ['insert_after',symbol,anchor,text,occurrence?], ['wrap',symbol,before,after,indent?], ['replace_return',symbol,expr,occurrence?], ['try_catch',symbol,catchBody,indent?].",
});

const patchOpsSchema = Type.Array(
	Type.Array(patchOpValueSchema, {
		minItems: 3,
		maxItems: 5,
		description: "One compact patch tuple.",
	}),
	{
		minItems: 1,
		maxItems: BATCH_MAX_ITEMS,
		description: "Compact Blitz patch tuples.",
	},
);

export const patchToolParamsSchema = Type.Object({
	file: pathSchema,
	ops: patchOpsSchema,
	dry_run: Type.Optional(Type.Boolean({ description: "No-write preview request for patch." })),
	include_diff: Type.Optional(Type.Boolean({ description: "Request compact diff summary in CLI output." })),
	diff_context: Type.Optional(Type.Number({ minimum: 0, maximum: 24, description: "Unified diff context lines when include_diff is true. Defaults to 12." })),
});

export const applyToolParamsSchema = Type.Object({
	file: pathSchema,
	operation: applyOperationSchema,
	target: applyTargetSchema,
	edit: applyEditSchema,
	dry_run: Type.Optional(Type.Boolean({ description: "No-write preview request for apply." })),
	include_diff: Type.Optional(
		Type.Boolean({ description: "Request compact diff summary in CLI output." }),
	),
	diff_context: Type.Optional(Type.Number({ minimum: 0, maximum: 24, description: "Unified diff context lines when include_diff is true. Defaults to 12." })),
	options: Type.Optional(applyOptionsSchema),
});

type BlitzApplyOperation =
	| "replace_body_span"
	| "insert_body_span"
	| "wrap_body"
	| "compose_body"
	| "multi_body"
	| "insert_after_symbol"
	| "set_body"
	| "patch";

const multiBodyEditItemSchema = Type.Object(
	{
		symbol: Type.String({ minLength: 1, maxLength: 512, description: "Target declaration symbol name only." }),
		op: Type.Union(
			[
				Type.Literal("replace_body_span"),
				Type.Literal("insert_body_span"),
				Type.Literal("wrap_body"),
			],
			{ description: "Structured body operation for one edit entry." },
		),
	},
	{ additionalProperties: true },
);

type BlitzApplyParams = {
	file: string;
	operation: BlitzApplyOperation;
	target?: {
		symbol: string;
		kind?: "function" | "method" | "class" | "variable" | "type";
		range?: "body" | "node";
	};
	edit: Record<string, unknown>;
	dry_run?: boolean;
	include_diff?: boolean;
	diff_context?: number;
	options?: {
		dryRun?: boolean;
		includeDiff?: boolean;
		diffContext?: number;
	};
};

type BlitzApplyPayload = {
	version: 1;
	file: string;
	operation: BlitzApplyOperation;
	target?: BlitzApplyParams["target"];
	edit: Record<string, unknown>;
	options?: {
		dryRun?: boolean;
		requireParseClean?: boolean;
		requireSingleMatch?: boolean;
		diffContext?: number;
	};
};

// Soft-error classifier — matches the signal taxonomy in docs/architecture/blitz.md.
const classifySoft = (stdout: string, stderr: string): BlitzSoftError | undefined => {
	if (/^No undo history for /m.test(stderr)) {
		return new BlitzSoftError({ reason: "no-undo-history", stderr, suggest: "no prior Blitz edit recorded for this file" });
	}
	if (/^No occurrences of /m.test(stderr)) {
		return new BlitzSoftError({
			reason: "no-occurrences",
			stderr,
			suggest: "run pi_blitz_read or use core edit",
		});
	}
	if (/^Error: no code references to /m.test(stderr)) {
		return new BlitzSoftError({
			reason: "no-references",
			stderr,
			suggest: "run pi_blitz_read or use core edit",
		});
	}
	// Stdout-only soft states are informational, handled separately.
	return stderr.trim().length > 0
		? new BlitzSoftError({ reason: "blitz-error", stderr })
		: undefined;
};

const okResult = (text: string, details?: BlitzToolResult["details"]): BlitzToolResult => ({
	content: [{ type: "text" as const, text }],
	details,
});

type EditMetrics = {
	status: "applied";
	command: "edit";
	mode: "replace" | "after";
	lane: "direct" | "marker";
	language: string;
	file: string;
	symbol: string;
	fileBytesBefore: number;
	fileBytesAfter: number;
	symbolBytesBefore: number;
	symbolBytesAfter: number;
	snippetBytes: number;
	blitzPayloadBytes: number;
	coreFullSymbolPayloadBytes: number;
	coreRealisticAnchorPayloadBytes: number;
	coreMinimalAnchorPayloadBytes: number;
	estimatedPayloadSavedBytesVsFullSymbol: number;
	estimatedPayloadSavedPctVsFullSymbol: number;
	estimatedPayloadSavedBytesVsRealisticAnchor: number;
	estimatedPayloadSavedPctVsRealisticAnchor: number;
	estimatedTokensSavedBytesDiv4VsRealisticAnchor: number;
	estimatedPayloadSavedBytesVsMinimalAnchor: number;
	estimatedPayloadSavedPctVsMinimalAnchor: number;
	estimatedTokensSavedBytesDiv4VsMinimalAnchor: number;
	realisticContextLines: number;
	usedMarkers: boolean;
	wallMs: number;
};

const parseEditMetrics = (stdout: string): EditMetrics | undefined => {
	try {
		const parsed = JSON.parse(stdout) as Partial<EditMetrics>;
		if (parsed.status !== "applied" || parsed.command !== "edit") return undefined;
		if (typeof parsed.estimatedPayloadSavedPctVsRealisticAnchor !== "number") return undefined;
		return parsed as EditMetrics;
	} catch {
		return undefined;
	}
};

const editMetricsResult = (metrics: EditMetrics): BlitzToolResult => {
	const changeLabel = `${metrics.fileBytesBefore}->${metrics.fileBytesAfter} bytes`;
	const lines: string[] = [];
	lines.push(`blitz edit applied: ${metrics.file}`);
	lines.push(`op: ${metrics.mode}`);
	const wallLine = formatDiffWallLine(changeLabel, metrics.wallMs);
	if (wallLine !== undefined) lines.push(wallLine);
	if (metrics.lane === "marker") lines.push("mode: marker");
	const contentText = lines.join("\n");
	return okResult(contentText, {
		status: metrics.status,
		opLabel: "edit",
		pathLabel: metrics.file,
		changeLabel,
		durationMs: metrics.wallMs,
		wallMs: metrics.wallMs,
		savingsPct: metrics.estimatedPayloadSavedPctVsRealisticAnchor,
		lane: metrics.lane,
		mode: metrics.mode,
		language: metrics.language,
		fileBytesBefore: metrics.fileBytesBefore,
		fileBytesAfter: metrics.fileBytesAfter,
		symbolBytesBefore: metrics.symbolBytesBefore,
		symbolBytesAfter: metrics.symbolBytesAfter,
		snippetBytes: metrics.snippetBytes,
		blitzPayloadBytes: metrics.blitzPayloadBytes,
		coreFullSymbolPayloadBytes: metrics.coreFullSymbolPayloadBytes,
		coreRealisticAnchorPayloadBytes: metrics.coreRealisticAnchorPayloadBytes,
		coreMinimalAnchorPayloadBytes: metrics.coreMinimalAnchorPayloadBytes,
		estimatedPayloadSavedBytesVsFullSymbol: metrics.estimatedPayloadSavedBytesVsFullSymbol,
		estimatedPayloadSavedPctVsFullSymbol: metrics.estimatedPayloadSavedPctVsFullSymbol,
		estimatedPayloadSavedBytesVsRealisticAnchor: metrics.estimatedPayloadSavedBytesVsRealisticAnchor,
		estimatedPayloadSavedPctVsRealisticAnchor: metrics.estimatedPayloadSavedPctVsRealisticAnchor,
		estimatedTokensSavedBytesDiv4VsRealisticAnchor: metrics.estimatedTokensSavedBytesDiv4VsRealisticAnchor,
		estimatedPayloadSavedBytesVsMinimalAnchor: metrics.estimatedPayloadSavedBytesVsMinimalAnchor,
		estimatedPayloadSavedPctVsMinimalAnchor: metrics.estimatedPayloadSavedPctVsMinimalAnchor,
		estimatedTokensSavedBytesDiv4VsMinimalAnchor: metrics.estimatedTokensSavedBytesDiv4VsMinimalAnchor,
		realisticContextLines: metrics.realisticContextLines,
		usedMarkers: metrics.usedMarkers,
		summary: lines.join(" · "),
	});
};

const classifySuccessStdout = (stdout: string): BlitzToolResult["details"] => {
	const parsed = parseApplyResponsePayload(stdout);
	if (parsed?.status === "needs_host_merge") {
		const details: BlitzToolResult["details"] = { status: "needs_host_merge", parseFallback: true };
		if (typeof parsed.code === "string" && parsed.code.trim().length > 0) details.code = parsed.code.trim();
		return details;
	}
	if (/^needs_host_merge\b/m.test(stdout) || stdout.trim().startsWith('{"status":"needs_host_merge"')) {
		return { status: "needs_host_merge", parseFallback: true };
	}
	if (/^No backup recorded for /m.test(stdout)) return { status: "no-backup" };
	if (/^No changes detected in /m.test(stdout)) return { status: "no-changes" };
	if (/^No results found\.$/m.test(stdout) || /^No references found\.$/m.test(stdout)) {
		return { status: "empty-results" };
	}
	if (/^Warning: .*chunk\(s\) rejected\. Partial edit applied\./m.test(stdout)) {
		return { warning: "partial-edit", partial: true };
	}
	if (/^Warning: merged output has parse errors/m.test(stdout)) {
		return { warning: "parse-error-post-write" };
	}
	if (/^\(\d+ lines\)$/m.test(stdout) && !/^L\d+-\d+/m.test(stdout)) {
		return { degraded: true };
	}
	return undefined;
};

const assertByteCap = (payload: string, maxBytes: number, label: string) => {
	const bytes = new TextEncoder().encode(payload).byteLength;
	if (bytes > maxBytes) {
		return new InvalidParamsError({
			reason: `${label} payload is ${bytes} bytes; cap is ${maxBytes}`,
		});
	}
	return null;
};

const isNonEmptyString = (value: unknown): value is string => {
	return typeof value === "string" && value.trim().length > 0;
};

const isOccurrence = (value: unknown): value is "only" | "first" | "last" | number => {
	if (value === "only" || value === "first" || value === "last") return true;
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
};

const isStructuredOp = (
	value: unknown,
): value is "replace_body_span" | "insert_body_span" | "wrap_body" => {
	return (
		value === "replace_body_span" ||
		value === "insert_body_span" ||
		value === "wrap_body"
	);
};

const isPatchTuple = (value: unknown): value is readonly unknown[] => {
	if (!Array.isArray(value) || value.length < 3 || value.length > 5) return false;
	const [op, symbol, a, b, c] = value;
	if (!isNonEmptyString(symbol)) return false;
	switch (op) {
		case "replace":
			return isNonEmptyString(a) && isNonEmptyString(b) && (c === undefined || isOccurrence(c));
		case "insert_after":
			return isNonEmptyString(a) && isNonEmptyString(b) && (c === undefined || isOccurrence(c));
		case "wrap":
			return isNonEmptyString(a) && isNonEmptyString(b) && (c === undefined || (typeof c === "number" && Number.isFinite(c) && c >= 0));
		case "replace_return":
			return isNonEmptyString(a) && (b === undefined || isOccurrence(b));
		case "try_catch":
			return isNonEmptyString(a) && (b === undefined || (typeof b === "number" && Number.isFinite(b) && b >= 0));
		default:
			return false;
	}
};

const assertApplyPayload = (params: BlitzApplyParams): InvalidParamsError | null => {
	switch (params.operation) {
		case "replace_body_span": {
			if (!isNonEmptyString(params.edit.find) || !isNonEmptyString(params.edit.replace)) {
				return new InvalidParamsError({ reason: "replace_body_span requires edit.find and edit.replace strings" });
			}
			if (params.edit.occurrence !== undefined && !isOccurrence(params.edit.occurrence)) {
				return new InvalidParamsError({
					reason: "replace_body_span occurrence must be one of: 'only', 'first', 'last', or non-negative integer",
				});
			}
			break;
		}
		case "insert_body_span": {
			if (!isNonEmptyString(params.edit.anchor) || !isNonEmptyString(params.edit.text)) {
				return new InvalidParamsError({ reason: "insert_body_span requires edit.anchor and edit.text strings" });
			}
			if (params.edit.position !== "before" && params.edit.position !== "after") {
				return new InvalidParamsError({
					reason: "insert_body_span position must be 'before' or 'after'",
				});
			}
			if (params.edit.occurrence !== undefined && !isOccurrence(params.edit.occurrence)) {
				return new InvalidParamsError({
					reason: "insert_body_span occurrence must be one of: 'only', 'first', 'last', or non-negative integer",
				});
			}
			break;
		}
		case "wrap_body": {
			if (!isNonEmptyString(params.edit.before) || !isNonEmptyString(params.edit.after)) {
				return new InvalidParamsError({
					reason: "wrap_body requires edit.before, edit.after, and edit.keep='body'",
				});
			}
			if (params.edit.keep !== "body") {
				return new InvalidParamsError({
					reason: "wrap_body keep must be 'body'",
				});
			}
			if (
				params.edit.indentKeptBodyBy !== undefined &&
				(typeof params.edit.indentKeptBodyBy !== "number" || params.edit.indentKeptBodyBy < 0)
			) {
				return new InvalidParamsError({
					reason: "wrap_body indentKeptBodyBy must be a non-negative number when provided",
				});
			}
			break;
		}
		case "compose_body": {
			if (!Array.isArray(params.edit.segments) || params.edit.segments.length < 1) {
				return new InvalidParamsError({ reason: "compose_body requires at least one segment" });
			}
			for (let i = 0; i < params.edit.segments.length; i++) {
				const segment = params.edit.segments[i];
				if (segment === null || typeof segment !== "object") {
					return new InvalidParamsError({ reason: `compose_body.segments[${i}] must be object` });
				}
				const seg = segment as Record<string, unknown>;
				const hasText = isNonEmptyString(seg.text);
				const hasKeep = seg.keep === "body";
				const hasKeepObject = seg.keep instanceof Object;
				if (!hasText && !hasKeep && !hasKeepObject) {
					return new InvalidParamsError({
						reason: `compose_body.segments[${i}] must contain text or keep payload`,
					});
				}
				if (hasText && (hasKeep || hasKeepObject)) {
					return new InvalidParamsError({
						reason: `compose_body.segments[${i}] must not mix text with keep`,
					});
				}
				if (hasKeepObject) {
					const keep = seg.keep as Record<string, unknown>;
					if (keep.beforeKeep !== undefined && !isNonEmptyString(keep.beforeKeep)) {
						return new InvalidParamsError({
							reason: `compose_body.segments[${i}].keep.beforeKeep must be string if provided`,
						});
					}
					if (keep.afterKeep !== undefined && !isNonEmptyString(keep.afterKeep)) {
						return new InvalidParamsError({
							reason: `compose_body.segments[${i}].keep.afterKeep must be string if provided`,
						});
					}
					if (
						keep.includeBefore !== undefined &&
						typeof keep.includeBefore !== "boolean"
					) {
						return new InvalidParamsError({
							reason: `compose_body.segments[${i}].keep.includeBefore must be boolean`,
						});
					}
					if (keep.includeAfter !== undefined && typeof keep.includeAfter !== "boolean") {
						return new InvalidParamsError({
							reason: `compose_body.segments[${i}].keep.includeAfter must be boolean`,
						});
					}
					if (keep.occurrence !== undefined && !isOccurrence(keep.occurrence)) {
						return new InvalidParamsError({
							reason: `compose_body.segments[${i}].keep.occurrence must be one of: 'only','first','last', or non-negative integer`,
						});
					}
				}
			}
			break;
		}
		case "insert_after_symbol": {
			if (!isNonEmptyString(params.edit.code)) {
				return new InvalidParamsError({ reason: "insert_after_symbol requires edit.code string" });
			}
			break;
		}
		case "set_body": {
			if (!isNonEmptyString(params.edit.body)) {
				return new InvalidParamsError({ reason: "set_body requires edit.body string" });
			}
			if (
				params.edit.indentation !== undefined &&
				params.edit.indentation !== "preserve" &&
				params.edit.indentation !== "normalize"
			) {
				return new InvalidParamsError({
					reason: "set_body indentation must be 'preserve' or 'normalize'",
				});
			}
			break;
		}
		case "patch": {
			if (!Array.isArray(params.edit.ops) || params.edit.ops.length < 1) {
				return new InvalidParamsError({ reason: "patch requires edit.ops array" });
			}
			for (let i = 0; i < params.edit.ops.length; i++) {
				if (!isPatchTuple(params.edit.ops[i])) {
					return new InvalidParamsError({ reason: `patch.ops[${i}] must be a valid tuple` });
				}
			}
			break;
		}
		case "multi_body": {
			if (!Array.isArray(params.edit.edits) || params.edit.edits.length < 1) {
				return new InvalidParamsError({ reason: "multi_body requires edit.edits array" });
			}
			for (let i = 0; i < params.edit.edits.length; i++) {
				const item = params.edit.edits[i];
				if (item === null || typeof item !== "object") {
					return new InvalidParamsError({ reason: `multi_body.edits[${i}] must be object` });
				}
				const editItem = item as MultiBodyEditItem;
				if (!isStructuredOp(editItem.op)) {
					return new InvalidParamsError({
						reason: `multi_body.edits[${i}].op must be one of: replace_body_span, insert_body_span, wrap_body`,
					});
				}
				if (!isNonEmptyString(editItem.symbol)) {
					return new InvalidParamsError({ reason: `multi_body.edits[${i}].symbol must be a non-empty string` });
				}
				const { symbol: _symbol, op: _op, ...edit } = editItem;
				const nested = assertApplyPayload({
					operation: editItem.op,
					target: { symbol: editItem.symbol, range: "body" },
					edit,
					file: params.file,
				} as BlitzApplyParams);
				if (nested !== null) return nested;
			}
			break;
		}
		default:
			return new InvalidParamsError({
				reason: `unsupported operation: ${params.operation as string}`,
			});
	}
	return null;
};

const wantsDiff = (params: BlitzApplyParams): boolean =>
	params.include_diff === true || params.options?.includeDiff === true;

const resolveDiffContext = (params: BlitzApplyParams): number | undefined => {
	if (!wantsDiff(params)) return undefined;
	if (typeof params.diff_context === "number") return params.diff_context;
	if (typeof params.options?.diffContext === "number") return params.options.diffContext;
	return 12;
};

const buildApplyRequest = (abs: string, params: BlitzApplyParams): BlitzApplyPayload => {
	const diffContext = resolveDiffContext(params);
	return {
		version: 1,
		file: abs,
		operation: params.operation,
		...(params.target !== undefined ? { target: params.target } : {}),
		edit: params.edit,
		options: {
			requireParseClean: true,
			requireSingleMatch: true,
			...(params.dry_run === true ? { dryRun: true } : {}),
			...(params.options?.dryRun === true ? { dryRun: true } : {}),
			...(diffContext !== undefined ? { diffContext } : {}),
		},
	};
};

const parseApplyResponsePayload = (stdout: string) => {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) return undefined;

	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) return undefined;

	try {
		const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
		if (typeof parsed !== "object" || parsed === null) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
};

type ApplyResponseMetrics = {
	estimatedPayloadSavedPctVsRealisticAnchor?: number;
	estimatedPayloadSavedBytesVsRealisticAnchor?: number;
	estimatedTokensSavedBytesDiv4VsRealisticAnchor?: number;
	wallMs?: number;
};

type ApplyResponseValidation = {
	parseClean?: boolean;
	parseErrorCount?: number;
};

type ApplyResponsePayload = {
	status?: string;
	code?: string;
	operation?: string;
	file?: string;
	validation?: ApplyResponseValidation;
	ranges?: unknown;
	diffSummary?: unknown;
	metrics?: ApplyResponseMetrics;
};

const isSavingsCandidate = (status: string | undefined, validation: ApplyResponseValidation | undefined) =>
	status === "applied" && validation?.parseClean === true;

const formatDiffSummary = (diffSummary: unknown): string | undefined => {
	if (typeof diffSummary === "string") return diffSummary;
	if (diffSummary === null || typeof diffSummary !== "object") return undefined;
	const summary =
		diffSummary as { added?: number; removed?: number; changed?: number; lines?: number; context?: number };
	const parts: string[] = [];
	if (typeof summary.added === "number") parts.push(`+${summary.added}`);
	if (typeof summary.removed === "number") parts.push(`-${summary.removed}`);
	if (typeof summary.changed === "number") parts.push(`~${summary.changed}`);
	if (typeof summary.lines === "number") parts.push(`${summary.lines} lines`);
	if (typeof summary.context === "number") parts.push(`context:${summary.context}`);
	return parts.length > 0 ? parts.join("/") : undefined;
};

const formatBlitzStatusLine = (status: string, fileLabel: string): string => {
	if (status === "applied") return `blitz patch applied: ${fileLabel}`;
	if (status === "preview") return `blitz patch preview: ${fileLabel}`;
	return `blitz patch ${status}: ${fileLabel}`;
};

const formatOpLabel = (operation: string, opLabel?: string): string | undefined => {
	if (opLabel !== undefined && opLabel.trim().length > 0) return `op: ${opLabel.trim()}`;
	if (operation.length === 0) return undefined;
	return `op: ${operation}`;
};

const formatParseLine = (validation: ApplyResponseValidation | undefined): string | undefined => {
	if (validation?.parseClean === undefined && validation?.parseErrorCount === undefined) return undefined;
	if (validation.parseClean === true) return "parse: clean";
	if (validation.parseClean === false) {
		return validation.parseErrorCount === undefined || validation.parseErrorCount <= 0
			? "parse: dirty"
			: `parse: dirty (${validation.parseErrorCount} parse errors)`;
	}
	if (validation.parseErrorCount === undefined) return undefined;
	return validation.parseErrorCount === 0 ? "parse: clean" : `parse: dirty (${validation.parseErrorCount} parse errors)`;
};

const formatDiffWallLine = (diffSummary: string | undefined, wallMs: number | undefined): string | undefined => {
	if (diffSummary === undefined && wallMs === undefined) return undefined;
	if (diffSummary === undefined) return `wall: ${wallMs}ms`;
	if (wallMs === undefined) return `changed: ${diffSummary}`;
	return `changed: ${diffSummary} · wall: ${wallMs}ms`;
};

const formatSavingsLine = (status: string, validation: ApplyResponseValidation | undefined, metric: ApplyResponseMetrics): string | undefined => {
	if (!isSavingsCandidate(status, validation)) return undefined;
	if (typeof metric.estimatedPayloadSavedPctVsRealisticAnchor !== "number") return undefined;
	if (metric.estimatedPayloadSavedPctVsRealisticAnchor < 30) return undefined;
	return `saved: ~${Math.round(metric.estimatedPayloadSavedPctVsRealisticAnchor)}% payload vs realistic-anchor edit`;
};

const derivePatchOpsLabel = (ops: unknown[]): string => {
	const labels = ops.flatMap((op): string[] => {
		if (!isPatchTuple(op)) return [];
		return [`${String(op[0])}(${typeof op[1] === "string" && op[1].trim().length > 0 ? op[1] : "?"})`];
	});
	if (labels.length === 0) return "patch";
	if (labels.length <= 3) return `patch(${labels.join(", ")})`;
	return `patch(${labels.length} ops)`;
};

const deriveMultiBodyLabel = (edits: unknown[]): string => {
	const labels = edits.map((entry): string => {
		if (entry === null || typeof entry !== "object") return "edit";
		const cast = entry as { op?: unknown; symbol?: unknown };
		const op = isNonEmptyString(cast.op) ? cast.op : "edit";
		const symbol = isNonEmptyString(cast.symbol) ? cast.symbol : "?";
		return `${op}(${symbol})`;
	});
	if (labels.length === 0) return "multi_body";
	if (labels.length <= 2) return `multi_body(${labels.join(", ")})`;
	return `multi_body(${labels.length} edits)`;
};

const deriveApplyOpLabel = (payloadOp: string, params?: BlitzApplyParams): string => {
	if (params === undefined) return payloadOp;
	if (params.operation === "patch" && Array.isArray((params.edit as Record<string, unknown>).ops)) {
		const ops = (params.edit as Record<string, unknown>).ops as unknown[];
		return derivePatchOpsLabel(ops);
	}
	if (params.operation === "multi_body" && Array.isArray((params.edit as Record<string, unknown>).edits)) {
		const edits = (params.edit as Record<string, unknown>).edits as unknown[];
		return deriveMultiBodyLabel(edits);
	}
	if (isNonEmptyString(params.target?.symbol)) return `${payloadOp}(${params.target.symbol})`;
	return params.operation;
};

type ApplyFormatContext = {
	opLabel?: string;
	fileLabel?: string;
};

const applyResultToText = (payload: ApplyResponsePayload, context: ApplyFormatContext = {}): BlitzToolResult => {
	const status = payload.status ?? "unknown";
	const code = typeof payload.code === "string" && payload.code.trim().length > 0 ? payload.code.trim() : undefined;
	const operation = payload.operation ?? "unknown";
	const file = payload.file ?? context.fileLabel ?? "(unknown)";
	const metric = payload.metrics ?? {};
	const parse = payload.validation;
	const diffSummary = formatDiffSummary(payload.diffSummary);
	const lines: string[] = [];
	lines.push(formatBlitzStatusLine(status, file));
	if (code !== undefined) lines.push(`code: ${code}`);
	const opLine = formatOpLabel(operation, context.opLabel);
	if (opLine !== undefined) lines.push(opLine);
	const parseLine = formatParseLine(parse);
	if (parseLine !== undefined) lines.push(parseLine);
	const changeLine = formatDiffWallLine(diffSummary, typeof metric.wallMs === "number" ? metric.wallMs : undefined);
	if (changeLine !== undefined) lines.push(changeLine);
	const savingsLine = formatSavingsLine(status, parse, metric);
	if (savingsLine !== undefined) lines.push(savingsLine);
	const contentText = lines.join("\n");
	const summaryParts = [
		`status=${status}`,
		code !== undefined ? `code=${code}` : undefined,
		context.opLabel !== undefined ? context.opLabel : operation,
		parse?.parseClean !== undefined ? `parse=${parse.parseClean ? "clean" : "dirty"}` : undefined,
		diffSummary,
		typeof metric.wallMs === "number" ? `wall=${metric.wallMs}ms` : undefined,
	].filter((value): value is string => value !== undefined && value.trim().length > 0);
	const details: PiBlitzDetails = {
		status,
		...(code !== undefined ? { code } : {}),
		operation,
		file,
		pathLabel: file,
		ranges: payload.ranges,
		diffSummary: payload.diffSummary,
		validation: parse,
		metrics: metric,
		summary: summaryParts.join(" · "),
	};
	if (context.opLabel !== undefined) details.opLabel = context.opLabel;
	if (typeof metric.wallMs === "number") {
		details.durationMs = metric.wallMs;
		details.wallMs = metric.wallMs;
	}
	if (typeof metric.estimatedPayloadSavedPctVsRealisticAnchor === "number") {
		details.savingsPct = metric.estimatedPayloadSavedPctVsRealisticAnchor;
	}
	if (diffSummary !== undefined) details.changeLabel = diffSummary;
	return okResult(contentText, details);
};

export const parseApplyResultPayload = (stdout: string): ApplyResponsePayload | undefined => {
	const parsed = parseApplyResponsePayload(stdout);
	return typeof parsed === "undefined" ? undefined : (parsed as ApplyResponsePayload);
};

const classifyApplyFailure = (stdout: string, stderr: string): BlitzSoftError | undefined => {
	const parsed = parseApplyResponsePayload(stdout);
	if (parsed?.status === "rejected") {
		const code = typeof parsed.code === "string" && parsed.code.trim().length > 0 ? parsed.code.trim() : undefined;
		return new BlitzSoftError({
			reason: "apply-rejected",
			stderr,
			...(code !== undefined ? { code } : {}),
			status: parsed.status,
		});
	}
	return classifySoft(stdout, stderr);
};

class SpawnException {
	constructor(public readonly cause: unknown) {}
}

const runBlitz = (
	binary: string,
	argv: string[],
	opts: { stdin?: string; cwd: string; timeoutMs: number; signal?: AbortSignal | undefined },
): Effect.Effect<
	{ stdout: string; stderr: string; exitCode: number },
	BlitzTimeoutError | BlitzMissingError
> =>
	Effect.gen(function* () {
		const cmd = [binary, "--workspace-root", opts.cwd, ...argv];
		const result = yield* Effect.tryPromise({
			try: () => {
				const spawnOpts: Parameters<typeof spawnCollectNode>[1] = {
					cwd: opts.cwd,
					timeoutMs: opts.timeoutMs,
					env: {
						...process.env,
						FASTEDIT_NO_UPDATE_CHECK: "1",
						BLITZ_NO_UPDATE_CHECK: "1",
						BLITZ_WORKSPACE: opts.cwd,
					},
				};
				if (opts.stdin !== undefined) spawnOpts.stdin = opts.stdin;
				if (opts.signal !== undefined) spawnOpts.signal = opts.signal;
				return spawnCollectNode(cmd, spawnOpts);
			},
			catch: (cause) => new SpawnException(cause),
		}).pipe(
			Effect.catch(
				(spawnErr: SpawnException): Effect.Effect<never, BlitzMissingError | BlitzTimeoutError> => {
					const msg = String(spawnErr.cause ?? "");
					if (/ENOENT|no such file|not found/i.test(msg)) {
						return Effect.fail(new BlitzMissingError({ binary }));
					}
					return Effect.fail(
						new BlitzTimeoutError({ command: cmd.join(" "), timeoutMs: opts.timeoutMs }),
					);
				},
			),
		);
		if (result.exitCode === 124) {
			return yield* Effect.fail(
				new BlitzTimeoutError({ command: cmd.join(" "), timeoutMs: opts.timeoutMs }),
			);
		}
		if (result.exitCode === 127) {
			return yield* Effect.fail(new BlitzMissingError({ binary }));
		}
		return result;
	});

const bindPath = (rawFile: string, cwd: string) => canonicalize(rawFile, cwd);

// ---------------- Tools ----------------

const executeApplyParams = (
	binary: string,
	cwd: string,
	params: BlitzApplyParams,
	opts: { signal?: AbortSignal | undefined; onUpdate?: ToolProgressUpdate | undefined } = {},
): Promise<BlitzToolResult> => {
	const { signal, onUpdate } = opts;
	const run = async () => {
		const eff = Effect.gen(function* () {
			if (params.operation !== "multi_body" && params.operation !== "patch" && !isNonEmptyString(params.target?.symbol)) {
				return yield* Effect.fail(
					new InvalidParamsError({ reason: "target.symbol must be a non-empty string" }),
				);
			}
			const validate = assertApplyPayload(params);
			if (validate !== null) return yield* Effect.fail(validate);
			const abs = yield* bindPath(params.file, cwd);
			const requestPayload = buildApplyRequest(abs, params);
			const request = JSON.stringify(requestPayload);
			const tooBig = assertByteCap(request, APPLY_MAX_PAYLOAD, "apply request");
			if (tooBig !== null) return yield* Effect.fail(tooBig);
			const argv = ["apply", "--edit", "-", "--json"];
			if (params.dry_run === true || params.options?.dryRun === true) argv.push("--dry-run");
			if (wantsDiff(params)) argv.push("--diff");
			const res = yield* locks.withLock(
				abs,
				runBlitz(binary, argv, {
					stdin: request,
					cwd,
					timeoutMs: 60_000,
					signal,
				}),
			);
			if (res.exitCode === 0) {
				const parsed = parseApplyResponsePayload(res.stdout);
				if (parsed !== undefined) {
					const parsedOperation = typeof parsed.operation === "string" ? parsed.operation : params.operation;
					return applyResultToText(parsed as ApplyResponsePayload, {
						opLabel: deriveApplyOpLabel(parsedOperation, params),
						fileLabel: params.file,
					});
				}
				return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
			}
			const soft = classifyApplyFailure(res.stdout, res.stderr);
			return yield* Effect.fail(
				soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
			);
		});
		return runTool(eff, (v) => v);
	};
	return runWithProgress(
		onUpdate,
		`blitz: running ${params.operation}`,
		"blitz: done",
		{ status: "running", operation: params.operation, file: params.file },
		run,
	);
};

export const piBlitzApplyToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_apply",
		label: "blitz apply",
		description:
			"Structured v0.2 apply via JSON IR. Use operation enum + target + edit payload. Prefer this for deterministic symbol edits and scoped wraps/insertions.",
		...blitzRenderers,
		parameters: applyToolParamsSchema,
		execute: async (
			_tcid: string,
			params: BlitzApplyParams,
			_signal?: AbortSignal,
			onUpdate?: ToolProgressUpdate,
			_ctx?: unknown,
		): Promise<BlitzToolResult> => executeApplyParams(binary, cwd, params, { signal: _signal, onUpdate }),
	}) as const;

const occurrenceSchema = Type.Optional(
	Type.Union([Type.Literal("only"), Type.Literal("first"), Type.Literal("last"), Type.Number()], {
		description: "Which occurrence to target. Use 'only' unless duplicate anchors are expected; use 'last' for tail edits.",
	}),
);

const narrowApplyBaseSchema = {
	file: pathSchema,
	symbol: Type.String({ minLength: 1, maxLength: 512, description: "Target declaration symbol name only." }),
	dry_run: Type.Optional(Type.Boolean({ description: "No-write preview request." })),
	include_diff: Type.Optional(Type.Boolean({ description: "Request diff summary from blitz." })),
	diff_context: Type.Optional(Type.Number({ minimum: 0, maximum: 24, description: "Unified diff context lines when include_diff is true. Defaults to 12." })),
};

type NarrowCommonParams = {
	file: string;
	symbol: string;
	dry_run?: boolean;
	include_diff?: boolean;
	diff_context?: number;
};

type ReplaceBodySpanParams = NarrowCommonParams & {
	find: string;
	replace: string;
	occurrence?: "only" | "first" | "last" | number;
};

type InsertBodySpanParams = NarrowCommonParams & {
	anchor: string;
	position: "before" | "after";
	text: string;
	occurrence?: "only" | "first" | "last" | number;
};

type WrapBodyParams = NarrowCommonParams & {
	before: string;
	after: string;
	indentKeptBodyBy?: number;
};

type ComposeBodyParams = NarrowCommonParams & {
	segments: Array<Record<string, unknown>>;
};

type TryCatchParams = NarrowCommonParams & {
	catchBody: string;
	indent?: number;
};

type ReplaceReturnParams = NarrowCommonParams & {
	expr: string;
	occurrence?: "only" | "first" | "last" | number;
};

type MultiBodyEditItem = Record<string, unknown> & {
	symbol: string;
	op: "replace_body_span" | "insert_body_span" | "wrap_body";
};

type MultiBodyParams = Omit<NarrowCommonParams, "symbol"> & {
	edits: Array<MultiBodyEditItem>;
};

const toCommonApplyParams = (
	params: NarrowCommonParams,
	operation: BlitzApplyOperation,
	edit: Record<string, unknown>,
): BlitzApplyParams => ({
	file: params.file,
	operation,
	target: { symbol: params.symbol, range: "body" },
	edit,
	...(params.dry_run !== undefined ? { dry_run: params.dry_run } : {}),
	...(params.include_diff !== undefined ? { include_diff: params.include_diff } : {}),
	...(params.diff_context !== undefined ? { diff_context: params.diff_context } : {}),
});

export const replaceBodySpanToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_replace_body_span",
		label: "blitz replace body span",
		description:
			"Compact structured edit: replace exact text inside a symbol body. Use for medium/large symbols when exact in-body span is known. For tiny unique text edits, core edit may be cheaper.",
		...blitzRenderers,
		parameters: Type.Object({
			...narrowApplyBaseSchema,
			find: Type.String({ minLength: 1, maxLength: SNIPPET_MAX, description: "Exact text to find inside the symbol body." }),
			replace: Type.String({ minLength: 1, maxLength: SNIPPET_MAX, description: "Replacement text." }),
			occurrence: occurrenceSchema,
		}),
		execute: async (_tcid: string, params: ReplaceBodySpanParams, _signal?: AbortSignal, onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> =>
			executeApplyParams(
				binary,
				cwd,
				toCommonApplyParams(params, "replace_body_span", {
					find: params.find,
					replace: params.replace,
					...(params.occurrence !== undefined ? { occurrence: params.occurrence } : {}),
				}),
				{ signal: _signal, onUpdate },
			),
	}) as const;

export const insertBodySpanToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_insert_body_span",
		label: "blitz insert body span",
		description:
			"Compact structured edit: insert text before/after exact text inside a symbol body. Use for structural inserts in large symbols without repeating body text.",
		...blitzRenderers,
		parameters: Type.Object({
			...narrowApplyBaseSchema,
			anchor: Type.String({ minLength: 1, maxLength: SNIPPET_MAX, description: "Exact anchor text inside the symbol body." }),
			position: Type.Union([Type.Literal("before"), Type.Literal("after")], { description: "Insert before or after anchor." }),
			text: Type.String({ minLength: 1, maxLength: SNIPPET_MAX, description: "Text to insert." }),
			occurrence: occurrenceSchema,
		}),
		execute: async (_tcid: string, params: InsertBodySpanParams, _signal?: AbortSignal, onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> =>
			executeApplyParams(
				binary,
				cwd,
				toCommonApplyParams(params, "insert_body_span", {
					anchor: params.anchor,
					position: params.position,
					text: params.text,
					...(params.occurrence !== undefined ? { occurrence: params.occurrence } : {}),
				}),
				{ signal: _signal, onUpdate },
			),
	}) as const;

export const wrapBodyToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_wrap_body",
		label: "blitz wrap body",
		description:
			"Compact structured edit: wrap an entire symbol body without re-emitting it. Best token-saving path for try/catch, guards, timing wrappers, and similar large-body transforms.",
		...blitzRenderers,
		parameters: Type.Object({
			...narrowApplyBaseSchema,
			before: Type.String({ minLength: 1, maxLength: SNIPPET_MAX, description: "Text placed before kept body." }),
			after: Type.String({ minLength: 1, maxLength: SNIPPET_MAX, description: "Text placed after kept body." }),
			indentKeptBodyBy: Type.Optional(Type.Number({ minimum: 0, description: "Spaces to add before each kept body line." })),
		}),
		execute: async (_tcid: string, params: WrapBodyParams, _signal?: AbortSignal, onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> =>
			executeApplyParams(
				binary,
				cwd,
				toCommonApplyParams(params, "wrap_body", {
					before: params.before,
					keep: "body",
					after: params.after,
					...(params.indentKeptBodyBy !== undefined ? { indentKeptBodyBy: params.indentKeptBodyBy } : {}),
				}),
				{ signal: _signal, onUpdate },
			),
	}) as const;

export const composeBodyToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_compose_body",
		label: "blitz compose body",
		description:
			"Compact structured edit: compose a symbol body from text segments and kept ranges. Use for multi-hunk/preserve-island edits in medium/large symbols.",
		...blitzRenderers,
		parameters: Type.Object({
			...narrowApplyBaseSchema,
			segments: Type.Array(Type.Record(Type.String({ minLength: 1, maxLength: 64 }), Type.Unknown()), {
				minItems: 1,
				maxItems: 32,
				description: "Segments: {text:string}, {keep:'body'}, or {keep:{beforeKeep?,afterKeep?,includeBefore?,includeAfter?,occurrence?}}.",
			}),
		}),
		execute: async (_tcid: string, params: ComposeBodyParams, _signal?: AbortSignal, onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> =>
			executeApplyParams(
				binary,
				cwd,
				toCommonApplyParams(params, "compose_body", { segments: params.segments }),
				{ signal: _signal, onUpdate },
			),
	}) as const;

export const multiBodyToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_multi_body",
		label: "blitz multi body",
		description:
			"Compact structured edit: apply multiple body-scoped edits in one apply request. Use when several symbol-body transforms should stay in one CLI call.",
		...blitzRenderers,
		parameters: Type.Object({
			file: pathSchema,
			dry_run: Type.Optional(Type.Boolean({ description: "No-write preview request." })),
			include_diff: Type.Optional(Type.Boolean({ description: "Request diff summary from blitz." })),
	diff_context: Type.Optional(Type.Number({ minimum: 0, maximum: 24, description: "Unified diff context lines when include_diff is true. Defaults to 12." })),
			edits: Type.Array(multiBodyEditItemSchema, {
				minItems: 1,
				maxItems: BATCH_MAX_ITEMS,
				description:
					"Edit entries. replace_body_span uses {symbol,op,find,replace,occurrence?}; insert_body_span uses {symbol,op,anchor,position,text,occurrence?}; wrap_body uses {symbol,op,before,after,indentKeptBodyBy?}.",
			}),
		}),
		execute: async (_tcid: string, params: MultiBodyParams, _signal?: AbortSignal, onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> =>
			executeApplyParams(
				binary,
				cwd,
				{
					file: params.file,
					operation: "multi_body",
					edit: { edits: params.edits },
					...(params.dry_run !== undefined ? { dry_run: params.dry_run } : {}),
					...(params.include_diff !== undefined ? { include_diff: params.include_diff } : {}),
					...(params.diff_context !== undefined ? { diff_context: params.diff_context } : {}),
				},
				{ signal: _signal, onUpdate },
			),
	}) as const;

export const patchToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_patch",
		label: "blitz patch",
		description:
			"Compact tuple patch wrapper. Use ops tuples for replace/insert_after/wrap/replace_return/try_catch without repeating full symbol bodies.",
		...blitzRenderers,
		parameters: patchToolParamsSchema,
		execute: async (
			_tcid: string,
			params: { file: string; ops: Array<unknown>; dry_run?: boolean; include_diff?: boolean; diff_context?: number },
			_signal?: AbortSignal,
			onUpdate?: ToolProgressUpdate,
			_ctx?: unknown,
		): Promise<BlitzToolResult> =>
			executeApplyParams(binary, cwd, {
				file: params.file,
				operation: "patch",
				edit: { ops: params.ops },
				...(params.dry_run !== undefined ? { dry_run: params.dry_run } : {}),
				...(params.include_diff !== undefined ? { include_diff: params.include_diff } : {}),
				...(params.diff_context !== undefined ? { diff_context: params.diff_context } : {}),
			},
			{ signal: _signal, onUpdate }),
	}) as const;

export const tryCatchToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_try_catch",
		label: "blitz try catch",
		description:
			"Compact semantic edit: wrap a symbol body in TypeScript try/catch without repeating the body. Use for large functions that need catch logging/rethrow logic.",
		...blitzRenderers,
		parameters: Type.Object({
			...narrowApplyBaseSchema,
			catchBody: Type.String({ minLength: 1, maxLength: SNIPPET_MAX, description: "Catch body, without outer catch braces." }),
			indent: Type.Optional(Type.Number({ minimum: 0, description: "Spaces to add before each kept body line. Defaults to 2." })),
		}),
		execute: async (_tcid: string, params: TryCatchParams, _signal?: AbortSignal, onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> =>
			executeApplyParams(binary, cwd, {
				file: params.file,
				operation: "patch",
				edit: { ops: [["try_catch", params.symbol, params.catchBody, ...(params.indent !== undefined ? [params.indent] : [])]] },
				...(params.dry_run !== undefined ? { dry_run: params.dry_run } : {}),
				...(params.include_diff !== undefined ? { include_diff: params.include_diff } : {}),
				...(params.diff_context !== undefined ? { diff_context: params.diff_context } : {}),
			},
			{ signal: _signal, onUpdate }),
	}) as const;

export const replaceReturnToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_replace_return",
		label: "blitz replace return",
		description:
			"Compact semantic edit: replace a return statement expression inside a symbol body. Avoids repeating surrounding logic.",
		...blitzRenderers,
		parameters: Type.Object({
			...narrowApplyBaseSchema,
			expr: Type.String({ minLength: 1, maxLength: SNIPPET_MAX, description: "Return expression, without leading return and without required trailing semicolon." }),
			occurrence: occurrenceSchema,
		}),
		execute: async (_tcid: string, params: ReplaceReturnParams, _signal?: AbortSignal, onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> =>
			executeApplyParams(binary, cwd, {
				file: params.file,
				operation: "patch",
				edit: { ops: [["replace_return", params.symbol, params.expr, ...(params.occurrence !== undefined ? [params.occurrence] : [])]] },
				...(params.dry_run !== undefined ? { dry_run: params.dry_run } : {}),
				...(params.include_diff !== undefined ? { include_diff: params.include_diff } : {}),
				...(params.diff_context !== undefined ? { diff_context: params.diff_context } : {}),
			},
			{ signal: _signal, onUpdate }),
	}) as const;

export const readToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_read",
		label: "blitz read",
		description: "AST structure summary of a source file (via blitz).",
		...blitzRenderers,
		parameters: Type.Object({ file: pathSchema }),
		execute: async (_tcid: string, params: { file: string }, _signal?: AbortSignal, _onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> => {
			const eff = Effect.gen(function* () {
				const abs = yield* bindPath(params.file, cwd);
				// Reads do not mutate — no mutex required.
				const res = yield* runBlitz(binary, ["read", abs], {
					cwd,
					timeoutMs: 30_000,
					signal: _signal,
				});
				if (res.exitCode === 0) return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
				const soft = classifySoft(res.stdout, res.stderr);
				if (soft) return yield* Effect.fail(soft);
				return yield* Effect.fail(
					new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
				);
			});
			return runTool(eff, (v) => v);
		},
	}) as const;

export const editToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_edit",
		label: "blitz edit",
		description:
			"Symbol-anchored AST edit. `replace` (symbol name) replaces only the body of the named function/class/method and preserves its signature automatically. `after` (symbol name) inserts code after that symbol. Exactly one of those two must be set, and the value must be the SYMBOL NAME, never source code. `snippet` is the new body. For large unchanged bodies, use `// ... existing code ...` or `// @keep` markers and never repeat unchanged code.",
		...blitzRenderers,
		parameters: Type.Object({
			file: pathSchema,
			snippet: snippetSchema,
			after: Type.Optional(afterSymbolSchema),
			replace: Type.Optional(replaceSymbolSchema),
		}),
		execute: async (
			_tcid: string,
			params: { file: string; snippet: string; after?: string; replace?: string },
			_signal?: AbortSignal,
			onUpdate?: ToolProgressUpdate,
			_ctx?: unknown,
		): Promise<BlitzToolResult> => {
			const run = async () => {
				const eff = Effect.gen(function* () {
					const hasAfter = params.after !== undefined && params.after.length > 0;
					const hasReplace = params.replace !== undefined && params.replace.length > 0;
					if (hasAfter === hasReplace) {
						return yield* Effect.fail(
							new InvalidParamsError({
								reason: "exactly one of `after` or `replace` must be set",
							}),
						);
					}
					// Runtime byte-length cap (complements TypeBox length cap).
					const tooBig = assertByteCap(params.snippet, SNIPPET_MAX, "snippet");
					if (tooBig !== null) return yield* Effect.fail(tooBig);
					const abs = yield* bindPath(params.file, cwd);
					const argv = [
						"edit",
						abs,
						"--snippet",
						"-",
						hasAfter ? "--after" : "--replace",
						(hasAfter ? params.after : params.replace)!,
						"--json",
					];
					const res = yield* locks.withLock(
						abs,
						runBlitz(binary, argv, {
							stdin: params.snippet,
							cwd,
							timeoutMs: 60_000,
							signal: _signal,
						}),
					);
					if (res.exitCode === 0) {
						const metrics = parseEditMetrics(res.stdout);
						if (metrics) return editMetricsResult(metrics);
						return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
					}
					const soft = classifySoft(res.stdout, res.stderr);
					return yield* Effect.fail(
						soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
					);
				});
				return runTool(eff, (v) => v);
			};
			return runWithProgress(
				onUpdate,
				"blitz: running edit",
				"blitz: done",
				{
					status: "running",
					operation: "edit",
					file: params.file,
				},
				run,
			);
			},
	}) as const;

export const batchToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_batch",
		label: "blitz batch-edit",
		description: "Multiple symbol-anchored edits in one file.",
		...blitzRenderers,
		parameters: Type.Object({
			file: pathSchema,
			edits: Type.Array(
				Type.Object({
					snippet: snippetSchema,
					after: Type.Optional(afterSymbolSchema),
					replace: Type.Optional(replaceSymbolSchema),
				}),
				{ minItems: 1, maxItems: BATCH_MAX_ITEMS },
			),
		}),
		execute: async (
			_tcid: string,
			params: {
				file: string;
				edits: Array<{ snippet: string; after?: string; replace?: string }>;
			},
			_signal: AbortSignal | undefined,
			onUpdate: ToolProgressUpdate | undefined,
			_ctx: unknown,
		): Promise<BlitzToolResult> => {
			const run = async () => {
				const eff = Effect.gen(function* () {
					// Per-edit XOR guard on `after`/`replace`.
					for (let i = 0; i < params.edits.length; i++) {
						const e = params.edits[i]!;
						const hasAfter = e.after !== undefined && e.after.length > 0;
						const hasReplace = e.replace !== undefined && e.replace.length > 0;
						if (hasAfter === hasReplace) {
							return yield* Effect.fail(
								new InvalidParamsError({
									reason: `edit[${i}]: exactly one of \`after\` or \`replace\` must be set`,
								}),
							);
						}
					}
					const json = JSON.stringify(params.edits);
					const tooBig = assertByteCap(json, BATCH_MAX_AGGREGATE, "batch");
					if (tooBig !== null) return yield* Effect.fail(tooBig);
					const abs = yield* bindPath(params.file, cwd);
					const res = yield* locks.withLock(
						abs,
						runBlitz(binary, ["batch-edit", abs, "--edits", "-"], {
							stdin: json,
							cwd,
							timeoutMs: 120_000,
							signal: _signal,
						}),
					);
					if (res.exitCode === 0) return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
					const soft = classifySoft(res.stdout, res.stderr);
					return yield* Effect.fail(
						soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
					);
				});
				return runTool(eff, (v) => v);
			};
			return runWithProgress(
				onUpdate,
				"blitz: running batch",
				"blitz: done",
				{
					status: "running",
					operation: "batch",
					file: params.file,
				},
				run,
			);
			},
	}) as const;

export const renameToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_rename",
		label: "blitz rename",
		description: "AST-verified single-file rename. Skips strings/comments/docstrings.",
		...blitzRenderers,
		parameters: Type.Object({
			file: pathSchema,
			old_name: renameSymbolSchema,
			new_name: renameSymbolSchema,
			dry_run: Type.Optional(Type.Boolean()),
		}),
		execute: async (
			_tcid: string,
			params: { file: string; old_name: string; new_name: string; dry_run?: boolean },
			_signal: AbortSignal | undefined,
			onUpdate: ToolProgressUpdate | undefined,
			_ctx: unknown,
		): Promise<BlitzToolResult> => {
			const run = async () => {
				const eff = Effect.gen(function* () {
					const abs = yield* bindPath(params.file, cwd);
					const argv = ["rename", abs, params.old_name, params.new_name];
					if (params.dry_run === true) argv.push("--dry-run");
					// Dry-run does not mutate; real rename acquires lock.
					const runBlitzCall = runBlitz(binary, argv, { cwd, timeoutMs: 60_000, signal: _signal });
					const res =
						params.dry_run === true
							? yield* runBlitzCall
							: yield* locks.withLock(abs, runBlitzCall);
					if (res.exitCode === 0) return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
					const soft = classifySoft(res.stdout, res.stderr);
					return yield* Effect.fail(
						soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
					);
				});
				return runTool(eff, (v) => v);
			};
			return runWithProgress(
				onUpdate,
				"blitz: running rename",
				"blitz: done",
				{
					status: "running",
					operation: "rename",
					file: params.file,
				},
				run,
			);
			},
	}) as const;

export const undoToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_undo",
		label: "blitz undo",
		description: "Revert the last blitz edit to a file (single-depth per path).",
		...blitzRenderers,
		parameters: Type.Object({
			file: pathSchema,
			confirm: Type.Literal(true, {
				description: "Must be explicitly set to true to acknowledge destructive action.",
			}),
		}),
		execute: async (
			_tcid: string,
			params: { file: string; confirm: true },
			_signal: AbortSignal | undefined,
			onUpdate: ToolProgressUpdate | undefined,
			_ctx: unknown,
		): Promise<BlitzToolResult> => {
			const run = async () => {
				const eff = Effect.gen(function* () {
					if (params.confirm !== true) {
						return yield* Effect.fail(
							new InvalidParamsError({ reason: "confirm must be true" }),
						);
					}
					const abs = yield* bindPath(params.file, cwd);
					const res = yield* locks.withLock(
						abs,
						runBlitz(binary, ["undo", abs], { cwd, timeoutMs: 30_000, signal: _signal }),
					);
					if (res.exitCode === 0) return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
					const soft = classifySoft(res.stdout, res.stderr);
					return yield* Effect.fail(
						soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
					);
				});
				return runTool(eff, (v) => v);
			};
			return runWithProgress(
				onUpdate,
				"blitz: running undo",
				"blitz: done",
				{
					status: "running",
					operation: "undo",
					file: params.file,
				},
				run,
			);
			},
	}) as const;

export const doctorToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_doctor",
		label: "blitz doctor",
		description: "Report blitz version, supported grammars, and backup cache health.",
		...blitzRenderers,
		parameters: Type.Object({}),
		execute: async (_tcid: string, _params: unknown, _signal?: AbortSignal, _onUpdate?: ToolProgressUpdate, _ctx?: unknown): Promise<BlitzToolResult> => {
			const eff = Effect.gen(function* () {
				const res = yield* runBlitz(binary, ["doctor"], { cwd, timeoutMs: 10_000, signal: _signal });
				if (res.exitCode === 0) return okResult(res.stdout.trimEnd());
				const soft = classifySoft(res.stdout, res.stderr);
				return yield* Effect.fail(
					soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
				);
			});
			return runTool(eff, (v) => v);
		},
	}) as const;


