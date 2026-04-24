import { Type } from "@sinclair/typebox";
import { Effect } from "effect";
import { spawnCollect } from "../../../shared/subprocess.js";
import { canonicalize } from "./paths.js";
import { runTool, type BlitzToolResult } from "./tool-runtime.js";
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

const pathSchema = Type.String({ minLength: 1, maxLength: PATH_MAX });
const snippetSchema = Type.String({ minLength: 1, maxLength: SNIPPET_MAX });
const symbolSchema = Type.String({ minLength: 1, maxLength: 512 });

// Soft-error classifier — matches the signal taxonomy in docs/architecture/blitz.md.
const classifySoft = (stdout: string, stderr: string): BlitzSoftError | undefined => {
	if (/^No undo history for /m.test(stderr)) {
		return new BlitzSoftError({ reason: "no-undo-history", stderr });
	}
	if (/^No occurrences of /m.test(stderr)) {
		return new BlitzSoftError({ reason: "no-occurrences", stderr });
	}
	if (/^Error: no code references to /m.test(stderr)) {
		return new BlitzSoftError({ reason: "no-references", stderr });
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

const classifySuccessStdout = (stdout: string): BlitzToolResult["details"] => {
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

class SpawnException {
	constructor(public readonly cause: unknown) {}
}

const runBlitz = (
	binary: string,
	argv: string[],
	opts: { stdin?: string; cwd: string; timeoutMs: number; signal?: AbortSignal },
): Effect.Effect<
	{ stdout: string; stderr: string; exitCode: number },
	BlitzTimeoutError | BlitzMissingError
> =>
	Effect.gen(function* () {
		const cmd = [binary, ...argv];
		const result = yield* Effect.tryPromise({
			try: () => {
				const spawnOpts: Parameters<typeof spawnCollect>[1] = {
					cwd: opts.cwd,
					timeoutMs: opts.timeoutMs,
					env: {
						...(process.env as Record<string, string>),
						FASTEDIT_NO_UPDATE_CHECK: "1",
						BLITZ_NO_UPDATE_CHECK: "1",
					},
				};
				if (opts.stdin !== undefined) spawnOpts.stdin = opts.stdin;
				if (opts.signal !== undefined) spawnOpts.signal = opts.signal;
				return spawnCollect(cmd, spawnOpts);
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

export const readToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_read",
		label: "blitz read",
		description: "AST structure summary of a source file (via blitz).",
		parameters: Type.Object({ file: pathSchema }),
		execute: async (_tcid: string, params: { file: string }): Promise<BlitzToolResult> => {
			const eff = Effect.gen(function* () {
				const abs = yield* bindPath(params.file, cwd);
				// Reads do not mutate — no mutex required.
				const res = yield* runBlitz(binary, ["read", abs], {
					cwd,
					timeoutMs: 30_000,
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
			"Symbol-anchored edit. Exactly one of `after` or `replace` must be set. Snippet goes via stdin.",
		parameters: Type.Object({
			file: pathSchema,
			snippet: snippetSchema,
			after: Type.Optional(symbolSchema),
			replace: Type.Optional(symbolSchema),
		}),
		execute: async (
			_tcid: string,
			params: { file: string; snippet: string; after?: string; replace?: string },
		): Promise<BlitzToolResult> => {
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
				];
				const res = yield* locks.withLock(
					abs,
					runBlitz(binary, argv, { stdin: params.snippet, cwd, timeoutMs: 60_000 }),
				);
				if (res.exitCode === 0) {
					return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
				}
				const soft = classifySoft(res.stdout, res.stderr);
				return yield* Effect.fail(
					soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
				);
			});
			return runTool(eff, (v) => v);
		},
	}) as const;

export const batchToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_batch",
		label: "blitz batch-edit",
		description: "Multiple symbol-anchored edits in one file.",
		parameters: Type.Object({
			file: pathSchema,
			edits: Type.Array(
				Type.Object({
					snippet: snippetSchema,
					after: Type.Optional(symbolSchema),
					replace: Type.Optional(symbolSchema),
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
		): Promise<BlitzToolResult> => {
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
					}),
				);
				if (res.exitCode === 0) return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
				const soft = classifySoft(res.stdout, res.stderr);
				return yield* Effect.fail(
					soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
				);
			});
			return runTool(eff, (v) => v);
		},
	}) as const;

export const renameToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_rename",
		label: "blitz rename",
		description: "AST-verified single-file rename. Skips strings/comments/docstrings.",
		parameters: Type.Object({
			file: pathSchema,
			old_name: symbolSchema,
			new_name: symbolSchema,
			dry_run: Type.Optional(Type.Boolean()),
		}),
		execute: async (
			_tcid: string,
			params: { file: string; old_name: string; new_name: string; dry_run?: boolean },
		): Promise<BlitzToolResult> => {
			const eff = Effect.gen(function* () {
				const abs = yield* bindPath(params.file, cwd);
				const argv = ["rename", abs, params.old_name, params.new_name];
				if (params.dry_run === true) argv.push("--dry-run");
				// Dry-run does not mutate; real rename acquires lock.
				const run = runBlitz(binary, argv, { cwd, timeoutMs: 60_000 });
				const res =
					params.dry_run === true
						? yield* run
						: yield* locks.withLock(abs, run);
				if (res.exitCode === 0) return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
				const soft = classifySoft(res.stdout, res.stderr);
				return yield* Effect.fail(
					soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
				);
			});
			return runTool(eff, (v) => v);
		},
	}) as const;

export const undoToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_undo",
		label: "blitz undo",
		description: "Revert the last blitz edit to a file (single-depth per path).",
		parameters: Type.Object({
			file: pathSchema,
			confirm: Type.Literal(true, {
				description: "Must be explicitly set to true to acknowledge destructive action.",
			}),
		}),
		execute: async (
			_tcid: string,
			params: { file: string; confirm: true },
		): Promise<BlitzToolResult> => {
			const eff = Effect.gen(function* () {
				if (params.confirm !== true) {
					return yield* Effect.fail(
						new InvalidParamsError({ reason: "confirm must be true" }),
					);
				}
				const abs = yield* bindPath(params.file, cwd);
				const res = yield* locks.withLock(
					abs,
					runBlitz(binary, ["undo", abs], { cwd, timeoutMs: 30_000 }),
				);
				if (res.exitCode === 0) return okResult(res.stdout.trimEnd(), classifySuccessStdout(res.stdout));
				const soft = classifySoft(res.stdout, res.stderr);
				return yield* Effect.fail(
					soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
				);
			});
			return runTool(eff, (v) => v);
		},
	}) as const;

export const doctorToolDef = (binary: string, cwd: string) =>
	({
		name: "pi_blitz_doctor",
		label: "blitz doctor",
		description: "Report blitz version, supported grammars, and backup cache health.",
		parameters: Type.Object({}),
		execute: async (): Promise<BlitzToolResult> => {
			const eff = Effect.gen(function* () {
				const res = yield* runBlitz(binary, ["doctor"], { cwd, timeoutMs: 10_000 });
				if (res.exitCode === 0) return okResult(res.stdout.trimEnd());
				const soft = classifySoft(res.stdout, res.stderr);
				return yield* Effect.fail(
					soft ?? new BlitzSoftError({ reason: "blitz-error", stderr: res.stderr }),
				);
			});
			return runTool(eff, (v) => v);
		},
	}) as const;


