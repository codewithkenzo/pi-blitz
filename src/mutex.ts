import { Effect } from "effect";

/**
 * Per-canonical-path mutex using `Effect.acquireUseRelease`.
 *
 * Serializes concurrent tool calls that target the same file. Multi-file
 * tools acquire locks in sorted canonical-path order to avoid deadlocks.
 */

type LockMap = Map<string, Promise<void>>;

export interface PathLocks {
	withLock: <A, E>(canonicalPath: string, eff: Effect.Effect<A, E>) => Effect.Effect<A, E>;
	withSortedLocks: <A, E>(paths: readonly string[], eff: Effect.Effect<A, E>) => Effect.Effect<A, E>;
}

export const makePathLocks = (): PathLocks => {
	const locks: LockMap = new Map();

	const withLock = <A, E>(canonicalPath: string, eff: Effect.Effect<A, E>): Effect.Effect<A, E> =>
		Effect.acquireUseRelease(
			Effect.sync(() => {
				const prev = locks.get(canonicalPath) ?? Promise.resolve();
				let release = () => {};
				const next = new Promise<void>((r) => {
					release = r;
				});
				const tail = prev.then(() => next);
				locks.set(canonicalPath, tail);
				return { prev, release, tail };
			}),
			({ prev }) => Effect.promise(() => prev).pipe(Effect.andThen(eff)),
			({ release, tail }) =>
				Effect.sync(() => {
					release();
					// Only clear the map entry when we are still the latest tail.
					// If a waiter already appended, they own the map slot now.
					if (locks.get(canonicalPath) === tail) {
						locks.delete(canonicalPath);
					}
				}),
		);

	const withSortedLocks = <A, E>(
		paths: readonly string[],
		eff: Effect.Effect<A, E>,
	): Effect.Effect<A, E> => {
		const sorted = [...new Set(paths)].sort();
		return sorted.reduceRight<Effect.Effect<A, E>>(
			(inner, path) => withLock(path, inner),
			eff,
		);
	};

	return { withLock, withSortedLocks };
};
