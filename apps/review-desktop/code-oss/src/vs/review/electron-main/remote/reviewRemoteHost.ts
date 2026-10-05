/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { get } from "node:http";
import type { Readable, Writable } from "node:stream";
import type { ReviewGatewayHost } from "../../common/reviewProtocol.js";
import { parseRemoteAttach, REVIEW_REMOTE_ATTACH_SCRIPT, type ReviewRemoteAttach } from "./reviewRemoteAttachScript.js";
import {
	sshCancelForwardArgs,
	sshCheckArgs,
	sshCloseArgs,
	sshExecArgs,
	sshForwardArgs,
	sshMasterArgs,
	type ReviewSshSession,
} from "./reviewSshCommand.js";

export interface SshChildProcess {
	readonly pid?: number;
	readonly exitCode: number | null;
	readonly signalCode: NodeJS.Signals | null;
	readonly stdin: Writable | null;
	readonly stdout: Readable | null;
	readonly stderr: Readable | null;
	kill(signal?: NodeJS.Signals): boolean;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	once(event: string, listener: (...args: any[]) => void): unknown;
}

/** Spawns `ssh` with `args`. Every call is detached: without a terminal, ssh can only prompt through askpass. */
export type SpawnSsh = (
	args: string[],
	options: { env: NodeJS.ProcessEnv; detached: true; stdio: ["pipe" | "ignore", "pipe" | "ignore", "pipe"] },
) => SshChildProcess;

export interface ReviewRemoteClock {
	now(): number;
	schedule(ms: number, run: () => void): () => void;
}

export const systemClock: ReviewRemoteClock = {
	now: () => Date.now(),
	schedule(ms, run) {
		const timer = setTimeout(run, ms);
		return () => clearTimeout(timer);
	},
};

export const REVIEW_REMOTE_TIMEOUTS = {
	poll: 250,
	connect: 30_000,
	attach: 60_000,
	operation: 10_000,
	close: 2_000,
	stable: 30_000,
};

const FIRST_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const OUTPUT_LIMIT = 64 * 1024;

export function reconnectDelay(failures: number, random: () => number = Math.random): number {
	const base = Math.min(FIRST_DELAY_MS * 2 ** failures, MAX_DELAY_MS);
	return Math.round(Math.min(MAX_DELAY_MS, Math.max(FIRST_DELAY_MS, base * (0.75 + 0.5 * random()))));
}

export function classifySshFailure(stderr: string, promptCancelled: boolean): "auth-failed" | "unreachable" {
	return promptCancelled || /Permission denied|Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(stderr)
		? "auth-failed"
		: "unreachable";
}

export const OPENSSH_NEEDED = "OpenSSH is needed: no `ssh` command was found on PATH.";

type Problem = NonNullable<ReviewGatewayHost["problem"]>;

class HostFailure extends Error {
	constructor(readonly problem: Problem) {
		super(problem.detail);
	}
}

const unreachable = (detail: string) => new HostFailure({ state: "unreachable", detail });

function meaningfulLines(text: string): string[] {
	return (
		text
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("Warning: Permanently added"))
	);
}

function firstLines(text: string, count = 6): string {
	return meaningfulLines(text).slice(0, count).join("\n").slice(0, 1000);
}

function lastLines(text: string, count = 6): string {
	return meaningfulLines(text).slice(-count).join("\n").slice(-1000);
}

const gone = (child: SshChildProcess) => child.exitCode !== null || child.signalCode !== null;

function exitedWithin(child: SshChildProcess, ms: number): Promise<boolean> {
	if (gone(child)) return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), ms);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function probeHealth(port: number, timeout: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = get({ host: "127.0.0.1", port, path: "/health", timeout }, (response) => {
			response.resume();
			if (response.statusCode === 200) resolve();
			else reject(new Error(`/health answered ${response.statusCode}`));
		});
		request.on("timeout", () => request.destroy(new Error(`/health did not answer within ${timeout / 1000} seconds`)));
		request.on("error", reject);
	});
}

export interface RunResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: NodeJS.ErrnoException;
	readonly timedOut: boolean;
}

export function runSsh(spawn: SpawnSsh, env: NodeJS.ProcessEnv, args: string[], timeout: number, input?: string): Promise<RunResult> {
	return new Promise((resolve) => {
		let child: SshChildProcess;
		try {
			child = spawn(args, { env, detached: true, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
		} catch (error) {
			return resolve({ code: null, stdout: "", stderr: "", error: error as NodeJS.ErrnoException, timedOut: false });
		}
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const done = (result: Omit<RunResult, "stdout" | "stderr" | "timedOut">) => {
			clearTimeout(timer);
			resolve({ ...result, stdout, stderr, timedOut });
		};
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
			done({ code: null });
		}, timeout);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => (stdout = (stdout + chunk).slice(-OUTPUT_LIMIT)));
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(0, OUTPUT_LIMIT)));
		child.once("error", (error: NodeJS.ErrnoException) => done({ code: null, error }));
		child.once("close", (code: number | null) => done({ code }));
		if (input !== undefined) {
			child.stdin?.on("error", () => {});
			child.stdin?.end(input);
		}
	});
}

export interface ReviewRemoteHostOptions {
	readonly session: ReviewSshSession;
	readonly spawn: SpawnSsh;
	environment(): Promise<NodeJS.ProcessEnv>;
	desktopVersion(): Promise<string>;
	freePort(): Promise<number>;
	report(host: ReviewGatewayHost): void;
	log(message: string): void;
	readonly clock?: ReviewRemoteClock;
	readonly timeouts?: Partial<typeof REVIEW_REMOTE_TIMEOUTS>;
	readonly random?: () => number;
}

export class ReviewRemoteHost {
	private readonly alias: string;
	private readonly clock: ReviewRemoteClock;
	private readonly timeouts: typeof REVIEW_REMOTE_TIMEOUTS;
	private reported: ReviewGatewayHost;
	private generation = 0;
	private master: SshChildProcess | undefined;
	private readonly closing = new Map<SshChildProcess, Promise<void>>();
	private forwarded: { local: number; remote: number } | undefined;
	private reattaching = false;
	private reattaches = 0;
	private cancelReattach: (() => void) | undefined;
	private masterStderr = "";
	private env: NodeJS.ProcessEnv | undefined;
	private connectedAt: number | undefined;
	private failures = 0;
	private cancelTimer: (() => void) | undefined;
	private prompts = 0;
	private promptCancelled = false;
	private disposed = false;

	constructor(private readonly options: ReviewRemoteHostOptions) {
		this.alias = options.session.alias;
		this.clock = options.clock ?? systemClock;
		this.timeouts = { ...REVIEW_REMOTE_TIMEOUTS, ...options.timeouts };
		this.reported = { alias: this.alias };
	}

	get state(): ReviewGatewayHost {
		return this.reported;
	}

	start(): void {
		void this.connect();
	}

	retry(): void {
		if (this.disposed) return;
		this.generation++;
		this.failures = 0;
		this.dropMaster();
		this.set({ alias: this.alias });
		void this.connect();
	}

	async resume(): Promise<void> {
		if (this.disposed) return;
		if (this.cancelTimer) return void this.connect();
		const master = this.master;
		const port = this.forwarded?.local;
		if (!master || this.connectedAt === undefined || port === undefined) return;
		try {
			await probeHealth(port, this.timeouts.operation);
			return;
		} catch (error) {
			if (master !== this.master || this.disposed) return;
			this.options.log(`${this.alias}: no answer through the forward after resume (${(error as Error).message}); reconnecting.`);
		}
		this.generation++;
		this.dropMaster();
		void this.connect();
	}

	reattach(): Promise<void> {
		if (this.disposed || this.reattaching || this.cancelReattach || !this.master || this.connectedAt === undefined) return Promise.resolve();
		if (this.clock.now() - this.connectedAt >= this.timeouts.stable) this.reattaches = 0;
		if (this.reattaches++ === 0) return this.attachAgain();
		const delay = reconnectDelay(this.reattaches - 2, this.options.random);
		this.options.log(`${this.alias}: its server restarted again; attaching again in ${Math.round(delay / 1000)} s.`);
		this.cancelReattach = this.clock.schedule(delay, () => {
			this.cancelReattach = undefined;
			void this.attachAgain();
		});
		return Promise.resolve();
	}

	private async attachAgain(): Promise<void> {
		const env = this.env;
		const old = this.forwarded;
		if (this.disposed || this.reattaching || !this.master || this.connectedAt === undefined || !env || !old) return;
		const generation = this.generation;
		const stale = () => generation !== this.generation || this.disposed;
		this.reattaching = true;
		this.options.log(`${this.alias}: its server restarted; attaching again.`);
		try {
			const check = await this.run(sshCheckArgs(this.options.session, env), this.timeouts.operation);
			if (stale()) return;
			if (check.code !== 0) throw unreachable(`The SSH connection to ${this.alias} did not answer. ${firstLines(check.stderr)}`.trim());
			const attach = await this.attach(env);
			if (stale()) return;
			const url = await this.forward(env, attach);
			if (stale()) return;
			await this.run(sshCancelForwardArgs(this.options.session, old.local, old.remote, env), this.timeouts.operation);
			if (stale()) return;
			this.connectedAt = this.clock.now();
			this.set({ alias: this.alias, endpoint: { url, token: attach.token } });
		} catch (error) {
			if (stale()) return;
			this.fail(error instanceof HostFailure ? error.problem : { state: "unreachable", detail: (error as Error).message });
		} finally {
			this.reattaching = false;
		}
	}

	promptOpened(): void {
		this.prompts++;
	}

	promptClosed(answered: boolean): void {
		this.prompts = Math.max(0, this.prompts - 1);
		if (!answered) this.promptCancelled = true;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.generation++;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		const master = this.master;
		this.master = undefined;
		await this.close(master);
	}

	killNow(): void {
		for (const master of [this.master, ...this.closing.keys()]) master?.kill();
	}

	private set(state: ReviewGatewayHost): void {
		if (JSON.stringify(state) === JSON.stringify(this.reported)) return;
		this.reported = state;
		this.options.log(
			`${this.alias}: ${state.endpoint ? `online through ${state.endpoint.url}` : state.problem ? `${state.problem.state}: ${state.problem.detail}` : "connecting"}`,
		);
		this.options.report(state);
	}

	private async connect(): Promise<void> {
		const generation = ++this.generation;
		const stale = () => generation !== this.generation || this.disposed;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.connectedAt = undefined;
		this.promptCancelled = false;
		try {
			const env = await this.options.environment();
			if (stale()) return;
			this.env = env;
			await Promise.all(this.closing.values());
			if (stale()) return;
			const master = this.startMaster(env);
			await this.waitForMaster(master, env, stale);
			const attach = await this.attach(env);
			if (stale()) return;
			const url = await this.forward(env, attach);
			if (stale()) return;
			this.connectedAt = this.clock.now();
			this.masterStderr = "";
			this.set({ alias: this.alias, endpoint: { url, token: attach.token } });
		} catch (error) {
			if (stale()) return;
			this.fail(error instanceof HostFailure ? error.problem : { state: "unreachable", detail: (error as Error).message });
		}
	}

	private startMaster(env: NodeJS.ProcessEnv): SshChildProcess {
		let master: SshChildProcess;
		try {
			master = this.options.spawn(sshMasterArgs(this.options.session, env), {
				env,
				detached: true,
				stdio: ["ignore", "ignore", "pipe"],
			});
		} catch (error) {
			throw (error as NodeJS.ErrnoException).code === "ENOENT" ? unreachable(OPENSSH_NEEDED) : error;
		}
		this.master = master;
		this.masterStderr = "";
		master.stderr?.setEncoding("utf8");
		master.stderr?.on("data", (chunk: string) => (this.masterStderr = (this.masterStderr + chunk).slice(-OUTPUT_LIMIT)));
		master.once("error", (error: NodeJS.ErrnoException) => this.masterGone(master, null, error));
		// "close", not "exit": OpenSSH's last lines can arrive after the exit.
		master.once("close", (code: number | null) => this.masterGone(master, code));
		this.options.log(`${this.alias}: connecting, ssh pid ${master.pid}`);
		return master;
	}

	private masterGone(master: SshChildProcess, code: number | null, error?: NodeJS.ErrnoException): void {
		if (master !== this.master) return;
		this.master = undefined;
		if (error?.code === "ENOENT") return this.fail({ state: "unreachable", detail: OPENSSH_NEEDED });
		const exited = error?.message || `ssh exited with code ${code ?? "none"}.`;
		if (this.connectedAt !== undefined) {
			if (this.clock.now() - this.connectedAt >= this.timeouts.stable) this.failures = 0;
			return this.fail({
				state: "unreachable",
				detail: `The SSH connection to ${this.alias} ended: ${lastLines(this.masterStderr) || exited}`,
			});
		}
		this.fail({
			state: classifySshFailure(this.masterStderr, this.promptCancelled),
			detail: firstLines(this.masterStderr) || exited,
		});
	}

	private async waitForMaster(master: SshChildProcess, env: NodeJS.ProcessEnv, stale: () => boolean): Promise<void> {
		let since = Date.now();
		for (;;) {
			if (stale() || gone(master)) throw unreachable("The SSH connection ended.");
			const check = await this.run(sshCheckArgs(this.options.session, env), this.timeouts.operation);
			if (check.code === 0) return;
			if (this.prompts > 0) since = Date.now();
			if (Date.now() - since > this.timeouts.connect) {
				throw unreachable(`${this.alias} did not connect within ${this.timeouts.connect / 1000} seconds. ${firstLines(this.masterStderr)}`.trim());
			}
			await sleep(this.timeouts.poll);
		}
	}

	private async attach(env: NodeJS.ProcessEnv): Promise<ReviewRemoteAttach> {
		const result = await this.run(sshExecArgs(this.options.session, env), this.timeouts.attach, REVIEW_REMOTE_ATTACH_SCRIPT);
		const parsed = parseRemoteAttach(result.stdout);
		if (parsed && "attach" in parsed) return parsed.attach;
		if (parsed) throw unreachable(`whiteboard remote attach failed on ${this.alias}: ${parsed.error}`);
		if (result.timedOut) throw unreachable(`whiteboard remote attach on ${this.alias} did not finish within ${this.timeouts.attach / 1000} seconds.`);
		if (result.code === 127) {
			const version = await this.options.desktopVersion();
			throw new HostFailure({
				state: "not-installed",
				detail: `Whiteboard is not installed on ${this.alias}. Install it there with \`npm install -g @dev.fast/whiteboard@${version}\`. Node 24 is needed.`,
			});
		}
		throw unreachable(firstLines(result.stderr) || `whiteboard remote attach on ${this.alias} exited with code ${result.code ?? "none"}.`);
	}

	private async forward(env: NodeJS.ProcessEnv, attach: ReviewRemoteAttach): Promise<string> {
		this.forwarded = undefined;
		const port = await this.options.freePort();
		const forward = await this.run(sshForwardArgs(this.options.session, port, attach.port, env), this.timeouts.operation);
		if (forward.code !== 0) throw unreachable(`Could not forward a local port to ${this.alias}: ${firstLines(forward.stderr) || `ssh exited with code ${forward.code}`}`);
		try {
			await probeHealth(port, this.timeouts.operation);
		} catch (error) {
			const refused = /^.*administratively prohibited.*$/m.exec(this.masterStderr)?.[0];
			throw unreachable(refused ? `${this.alias} refused the port forward: ${refused}` : `The Whiteboard server on ${this.alias} did not answer through the forward: ${(error as Error).message}.`);
		}
		this.forwarded = { local: port, remote: attach.port };
		return `http://127.0.0.1:${port}`;
	}

	private fail(problem: Problem): void {
		this.generation++;
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.connectedAt = undefined;
		this.dropMaster();
		this.set({ alias: this.alias, problem });
		if (problem.state !== "unreachable" || this.disposed) return;
		const delay = reconnectDelay(this.failures++, this.options.random);
		this.cancelTimer = this.clock.schedule(delay, () => {
			this.cancelTimer = undefined;
			void this.connect();
		});
	}

	private dropMaster(): void {
		const master = this.master;
		this.master = undefined;
		this.forwarded = undefined;
		void this.close(master);
	}

	private close(master: SshChildProcess | undefined): Promise<void> {
		if (!master || gone(master)) return Promise.resolve();
		const pending = this.closing.get(master);
		if (pending) return pending;
		const closed = (async () => {
			// A master still connecting has no socket to take -O exit.
			const asked = this.env && (await this.run(sshCloseArgs(this.options.session, this.env), this.timeouts.close)).code === 0;
			if (!asked || !(await exitedWithin(master, this.timeouts.close))) master.kill("SIGTERM");
			await exitedWithin(master, this.timeouts.close);
		})().finally(() => this.closing.delete(master));
		this.closing.set(master, closed);
		return closed;
	}

	private run(args: string[], timeout: number, input?: string): Promise<RunResult> {
		return runSsh(this.options.spawn, this.env ?? {}, args, timeout, input);
	}
}
