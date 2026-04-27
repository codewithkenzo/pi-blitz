/**
 * Shared subprocess utilities — SpawnResult type + a reusable Effect-based runner.
 * All extension subprocess bridges (tk, git, sox, pi) use this interface.
 */

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Optional input piped to child stdin; stream is closed after write. */
  stdin?: string | Uint8Array;
  /** External abort signal; aborts wait + kills subprocess when signaled. */
  signal?: AbortSignal;
}

const DEFAULT_MAX_OUTPUT = 256 * 1024; // 256KB

/**
 * Runs a command and returns a SpawnResult.
 * Non-zero exit codes do NOT throw — caller decides what to do.
 *
 * Supports optional stdin payload and AbortSignal cancellation. Timeout and
 * external abort both map to exit code 124 (same convention as coreutils `timeout`).
 */
export const spawnCollect = async (
  argv: string[],
  opts: SpawnOptions = {},
): Promise<SpawnResult> => {
  const { cwd, env, timeoutMs, maxOutputBytes = DEFAULT_MAX_OUTPUT, stdin, signal } = opts;
  const start = Date.now();

  const [cmd, ...args] = argv;
  if (!cmd) throw new Error("spawnCollect: empty argv");

  const hasStdin = stdin !== undefined;
  const proc = hasStdin
    ? (cwd !== undefined
      ? Bun.spawn([cmd, ...args], {
          cwd,
          env: env ?? (process.env as Record<string, string>),
          stdin: "pipe" as const,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        })
      : Bun.spawn([cmd, ...args], {
          env: env ?? (process.env as Record<string, string>),
          stdin: "pipe" as const,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        }))
    : (cwd !== undefined
      ? Bun.spawn([cmd, ...args], {
          cwd,
          env: env ?? (process.env as Record<string, string>),
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        })
      : Bun.spawn([cmd, ...args], {
          env: env ?? (process.env as Record<string, string>),
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        }));

  if (hasStdin && typeof (proc as { stdin?: unknown }).stdin === "object") {
    const writer = (proc as { stdin: { write: (data: string | Uint8Array) => void; end: () => void } }).stdin;
    try {
      writer.write(stdin);
    } finally {
      writer.end();
    }
  }

  let aborted = false;
  const killProc = () => {
    aborted = true;
    proc.kill();
  };

  const timer = timeoutMs ? setTimeout(killProc, timeoutMs) : null;

  const onAbort = () => killProc();
  if (signal) {
    if (signal.aborted) {
      killProc();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    const [rawOut, rawErr] = await Promise.all([
      collectStream(proc.stdout, maxOutputBytes),
      collectStream(proc.stderr, maxOutputBytes),
    ]);

    await proc.exited;

    return {
      stdout: rawOut,
      stderr: rawErr,
      exitCode: aborted ? 124 : (proc.exitCode ?? -1),
      durationMs: Date.now() - start,
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
};

const collectStream = async (
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> => {
  if (!stream) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    if (total + chunk.byteLength > maxBytes) {
      chunks.push(chunk.slice(0, maxBytes - total));
      break;
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  return new TextDecoder().decode(
    chunks.reduce((acc, c) => {
      const merged = new Uint8Array(acc.byteLength + c.byteLength);
      merged.set(acc);
      merged.set(c, acc.byteLength);
      return merged;
    }, new Uint8Array(0)),
  );
};

/** Checks if a binary is available in PATH. */
export const binaryExists = async (name: string): Promise<boolean> => {
  const result = await spawnCollect(["which", name]).catch(() => null);
  return result !== null && result.exitCode === 0;
};
