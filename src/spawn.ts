import { spawn } from "node:child_process";

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
	stdin?: string | Uint8Array;
	signal?: AbortSignal;
}

const DEFAULT_MAX_OUTPUT = 256 * 1024;

export const spawnCollectNode = (
	argv: string[],
	opts: SpawnOptions = {},
): Promise<SpawnResult> =>
	new Promise((resolve, reject) => {
		const { cwd, env, timeoutMs, maxOutputBytes = DEFAULT_MAX_OUTPUT, stdin, signal } = opts;
		const [cmd, ...args] = argv;
		if (!cmd) {
			reject(new Error("spawnCollectNode: empty argv"));
			return;
		}

		const started = Date.now();
		let stdout = Buffer.alloc(0);
		let stderr = Buffer.alloc(0);
		let killedByTimeout = false;
		let settled = false;

		const child = spawn(cmd, args, {
			cwd,
			env: env ?? process.env,
			stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		});

		const finish = (result: SpawnResult) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onAbort);
			resolve(result);
		};

		const timer = timeoutMs
			? setTimeout(() => {
					killedByTimeout = true;
					child.kill("SIGKILL");
				}, timeoutMs)
			: undefined;

		const onAbort = () => {
			killedByTimeout = true;
			child.kill("SIGKILL");
		};
		if (signal) {
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}

		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onAbort);
			reject(err);
		});

		child.stdout?.on("data", (chunk: Buffer) => {
			if (stdout.byteLength >= maxOutputBytes) return;
			const remaining = maxOutputBytes - stdout.byteLength;
			stdout = Buffer.concat([stdout, chunk.subarray(0, remaining)]);
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.byteLength >= maxOutputBytes) return;
			const remaining = maxOutputBytes - stderr.byteLength;
			stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)]);
		});

		child.on("close", (code) => {
			finish({
				stdout: stdout.toString("utf8"),
				stderr: stderr.toString("utf8"),
				exitCode: killedByTimeout ? 124 : (code ?? -1),
				durationMs: Date.now() - started,
			});
		});

		if (stdin !== undefined && child.stdin) {
			child.stdin.end(stdin);
		}
	});
