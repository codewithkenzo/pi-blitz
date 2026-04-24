import { Effect } from "effect";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { InvalidParamsError, PathEscapeError } from "./errors.js";

const CONTROL_BYTE_RE = /[\x00-\x1f\x7f]/;

/**
 * Canonicalize a user-supplied path against the workspace cwd.
 *
 * Rules:
 * 1. Reject empty/NUL/control-byte paths → `InvalidParamsError`.
 * 2. Resolve against `cwd` (fallback to `process.cwd()`).
 * 3. `realpath` the result (resolve failures → `InvalidParamsError`).
 * 4. Reject when the realpath does not start with `realpath(cwd)`
 *    unless `trusted === true` → `PathEscapeError`.
 * 5. For downstream git subprocess calls, the caller must pass the
 *    canonicalized path after a `--` separator.
 */
export const canonicalize = (
	raw: string,
	cwd: string,
	trusted = false,
): Effect.Effect<string, InvalidParamsError | PathEscapeError> =>
	Effect.gen(function* () {
		if (raw.length === 0 || CONTROL_BYTE_RE.test(raw)) {
			return yield* Effect.fail(
				new InvalidParamsError({ reason: `invalid path: ${JSON.stringify(raw)}` }),
			);
		}
		const abs = isAbsolute(raw) ? raw : resolve(cwd, raw);
		const resolvedCwd = yield* Effect.tryPromise({
			try: () => realpath(cwd),
			catch: () =>
				new InvalidParamsError({ reason: `cannot resolve cwd realpath: ${cwd}` }),
		});
		const resolvedPath = yield* Effect.tryPromise({
			try: () => realpath(abs),
			catch: () =>
				new InvalidParamsError({ reason: `cannot resolve path realpath: ${abs}` }),
		});
		if (!trusted && !isInside(resolvedPath, resolvedCwd)) {
			return yield* Effect.fail(
				new PathEscapeError({ path: resolvedPath, cwd: resolvedCwd }),
			);
		}
		return resolvedPath;
	});

const isInside = (child: string, parent: string): boolean => {
	const normalizedParent = parent.endsWith(sep) ? parent : parent + sep;
	return child === parent || child.startsWith(normalizedParent);
};
