import { Effect } from "effect";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { spawnCollect } from "../../../shared/subprocess.js";
import { BlitzMissingError, BlitzVersionError } from "./errors.js";

export interface DoctorSnapshot {
	readonly ok: boolean;
	readonly blitz: { readonly present: boolean; readonly version?: string };
	readonly grammars: readonly string[];
	readonly rawStdout: string;
	readonly rawStderr: string;
	readonly checkedAt: number;
}

type CacheEntry = {
	readonly effect: Effect.Effect<DoctorSnapshot, BlitzMissingError | BlitzVersionError>;
	readonly ts: number;
};

const DEFAULT_TTL_MS = 600_000; // 10 minutes

const cache = new Map<string, CacheEntry>();

const cacheKey = (cwd: string, binary: string, configHash: string): string => {
	const h = createHash("sha256");
	h.update(cwd);
	h.update("\0");
	h.update(binary);
	h.update("\0");
	h.update(configHash);
	h.update("\0");
	// Include binary mtime so replacing the blitz executable at the same path
	// invalidates the cached doctor result immediately.
	try {
		const s = statSync(binary);
		h.update(String(s.mtimeMs));
		h.update(":");
		h.update(String(s.size));
	} catch {
		h.update("missing");
	}
	return h.digest("hex");
};

const MIN_VERSION = "0.0.1";

/**
 * Doctor run memoized per `{cwd, binary, configHash}`.
 *
 * `Effect.cached` returns `Effect<Effect<A, E, R>>` — the outer effect produces
 * the memoized inner. We keep the inner in a keyed Map so concurrent calls
 * share the same probe promise and TTL + config changes invalidate cleanly.
 */
export const getDoctor = (
	cwd: string,
	binary: string,
	configHash: string,
	ttlMs: number = DEFAULT_TTL_MS,
): Effect.Effect<DoctorSnapshot, BlitzMissingError | BlitzVersionError> =>
	Effect.suspend(() => {
		const key = cacheKey(cwd, binary, configHash);
		const hit = cache.get(key);
		const now = Date.now();
		if (hit && now - hit.ts < ttlMs) {
			return hit.effect;
		}
		const probe = probeBinary(binary, cwd);
		// Effect.cached returns Effect<Effect<A, E, R>>; run the outer once to extract
		// the memoized inner, then store the inner.
		const cachedInner = Effect.runSync(Effect.cached(probe));
		cache.set(key, { effect: cachedInner, ts: now });
		return cachedInner;
	});

const probeBinary = (
	binary: string,
	cwd: string,
): Effect.Effect<DoctorSnapshot, BlitzMissingError | BlitzVersionError> =>
	Effect.gen(function* () {
		const result = yield* Effect.tryPromise({
			try: () => spawnCollect([binary, "doctor"], { cwd, timeoutMs: 10_000 }),
			catch: () => new BlitzMissingError({ binary }),
		});
		if (result.exitCode === 127 || /command not found|no such file/i.test(result.stderr)) {
			return yield* Effect.fail(new BlitzMissingError({ binary }));
		}
		const version = parseVersion(result.stdout) ?? "unknown";
		if (version !== "unknown" && !meetsFloor(version, MIN_VERSION)) {
			return yield* Effect.fail(new BlitzVersionError({ found: version, required: MIN_VERSION }));
		}
		const snap: DoctorSnapshot = {
			ok: result.exitCode === 0,
			blitz: { present: true, version },
			grammars: parseGrammars(result.stdout),
			rawStdout: result.stdout,
			rawStderr: result.stderr,
			checkedAt: Date.now(),
		};
		return snap;
	});

const parseVersion = (stdout: string): string | undefined => {
	const m = stdout.match(/version:\s*([^\s]+)/i);
	return m?.[1];
};

const parseGrammars = (_stdout: string): string[] => {
	// Grammars are listed once `blitz doctor` prints them (ticket d1o-cewc).
	// For the scaffold, return empty.
	return [];
};

const meetsFloor = (found: string, floor: string): boolean => {
	const a = found.split(".").map((n) => parseInt(n, 10) || 0);
	const b = floor.split(".").map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const ai = a[i] ?? 0;
		const bi = b[i] ?? 0;
		if (ai > bi) return true;
		if (ai < bi) return false;
	}
	return true;
};
