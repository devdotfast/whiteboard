/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { rm } from "node:fs/promises";
import { get } from "node:http";
import type { Readable, Writable } from "node:stream";
import type { ReviewGatewayHost } from "../../common/reviewProtocol.js";
import { parseRemoteAttach, reviewRemoteAttachScript, type ReviewRemoteAttach } from "./reviewRemoteAttachScript.js";
import {
	sshCancelForwardArgs,
	sshCheckArgs,
	sshCloseArgs,
	sshExecArgs,
	sshForwardArgs,
	sshMasterArgs,
	type ReviewSshSession,
} from "./reviewSshCommand.js";

/** The slice of `ChildProcess` the host drives, so tests can supply their own. */
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
	/** Runs `run` after `ms`; the result cancels it. */
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
	/** Between `-O check` calls while the master connects. */
	poll: 250,
	/** For the master to answer, not counting time a prompt is open. */
	connect: 30_000,
	/** The whole attach; the remote may fetch diffr (15 s) and start a server. */
	attach: 60_000,
	/** `-O forward`, `-O check`, and the health probe through the forward. */
	operation: 10_000,
	/** After `-O exit`, before SIGTERM. */
	close: 2_000,
	/** A connection that lasted this long resets the backoff. */
	stable: 30_000,
};

const FIRST_DELAY_MS = 1_000;
/** A remote still installing its language extensions is attached again this often, at most this many times in a row. */
const PENDING_REATTACH_MS = 60_000;
const PENDING_ATTACHES = 10;
const MAX_DELAY_MS = 60_000;
const OUTPUT_LIMIT = 64 * 1024;

/** 1 s doubling to 60 s, with ±25% jitter, never outside 1 s to 60 s. */
export function reconnectDelay(failures: number, random: () => number = Math.random): number {
	const base = Math.min(FIRST_DELAY_MS * 2 ** failures, MAX_DELAY_MS);
	return Math.round(Math.min(MAX_DELAY_MS, Math.max(FIRST_DELAY_MS, base * (0.75 + 0.5 * random()))));
}

/** OpenSSH refused to authenticate or to trust the host, or the user cancelled a prompt: retrying alone cannot help. */
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
			// OpenSSH's note on a first connection to a host says nothing about the failure.
			.filter((line) => line && !line.startsWith("Warning: Permanently added"))
	);
}

/** OpenSSH's first lines; enough to say what happened. */
function firstLines(text: string, count = 6): string {
	return meaningfulLines(text).slice(0, count).join("\n").slice(0, 1000);
}

/** The last lines: why a long-lived master ended. */
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

/** One GET through the forward. A remote that refuses forwarding shows only here. */
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

/** The VS Code server's commit through its forward; `/version` needs no token. */
function probeVersion(port: number, timeout: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const request = get({ host: "127.0.0.1", port, path: "/version", timeout }, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => (body = (body + chunk).slice(0, 200)));
			response.on("end", () => (response.statusCode === 200 ? resolve(body.trim()) : reject(new Error(`/version answered ${response.statusCode}`))));
		});
		request.on("timeout", () => request.destroy(new Error(`/version did not answer within ${timeout / 1000} seconds`)));
		request.on("error", reject);
	});
}

/**
 * The VS Code server refuses a client of another commit. A dev Desktop has no
 * commit, and the server accepts it.
 */
export function languageCommitMismatch(alias: string, serverCommit: string, desktopCommit: string | undefined): string | undefined {
	if (!desktopCommit || desktopCommit === serverCommit) return undefined;
	return `language features need the same Whiteboard version on ${alias}: it runs ${serverCommit.slice(0, 7)}, this Desktop ${desktopCommit.slice(0, 7)}`;
}

type LanguageFeatures = Pick<ReviewGatewayHost, "languageFeatures" | "languageFeaturesDetail">;

export interface RunResult {
	readonly code: number | null;
	/** The last 64 KiB: the sentinels come at the end, after any login banner. */
	readonly stdout: string;
	/** The first 64 KiB: OpenSSH says what went wrong first. */
	readonly stderr: string;
	readonly error?: NodeJS.ErrnoException;
	readonly timedOut: boolean;
}

/** One short-lived ssh; output is bounded, and a timeout ends it. */
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
	/** Every ssh of this host runs with it: the login shell's environment plus askpass. */
	environment(): Promise<NodeJS.ProcessEnv>;
	/** The version the Desktop's own server reports: the one to install. */
	desktopVersion(): Promise<string>;
	/** The commit the Desktop's VS Code client sends; none in a dev build. */
	readonly desktopCommit?: string;
	/** The optional extension groups this Desktop has enabled. */
	groups?(): Promise<readonly string[]>;
	freePort(): Promise<number>;
	report(host: ReviewGatewayHost): void;
	log(message: string): void;
	readonly clock?: ReviewRemoteClock;
	readonly timeouts?: Partial<typeof REVIEW_REMOTE_TIMEOUTS>;
	readonly random?: () => number;
}

/**
 * One alias: a master connection, `whiteboard remote attach` through it, and
 * forwards to the remote server and its VS Code server. Reports an endpoint
 * or a problem, and reconnects with backoff when the master ends. The tokens
 * stay in memory.
 */
export class ReviewRemoteHost {
	private readonly alias: string;
	private readonly clock: ReviewRemoteClock;
	private readonly timeouts: typeof REVIEW_REMOTE_TIMEOUTS;
	private reported: ReviewGatewayHost;
	/** Bumped to abandon an attempt in flight. */
	private generation = 0;
	private master: SshChildProcess | undefined;
	/** Masters asked to exit that have not yet; a new master waits for them, since an exiting one unlinks the socket path. */
	private readonly closing = new Map<SshChildProcess, Promise<void>>();
	/** The ports of the forward to the remote server. */
	private forwarded: { local: number; remote: number } | undefined;
	/** The forward to the VS Code server, once it answered with a commit this Desktop can use. */
	private language: { local: number; remote: number; connectionToken: string; commit: string } | undefined;
	/** Attaches in a row that found the language extensions still installing. */
	private pendingAttaches = 0;
	private cancelPending: (() => void) | undefined;
	private serverId: string | null = null;
	private reattaching = false;
	/** Reattaches since the connection last stayed up `stable`; each further one waits longer. */
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

	/** Forgets the backoff and any problem, and connects at once. */
	retry(): void {
		if (this.disposed) return;
		this.generation++;
		this.failures = 0;
		this.dropMaster();
		this.set({ alias: this.alias });
		void this.connect();
	}

	/**
	 * After sleep: a host waiting to retry connects now. A connected host is
	 * probed through its forward, because `-O check` answers from local state
	 * while the TCP session may be dead; if it does not answer, the master is replaced.
	 */
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

	/**
	 * The remote server restarted with a new token: attach again over the
	 * same master. A server that keeps crashing is attached again with the
	 * reconnect backoff, reset once a connection stays up `stable`.
	 */
	reattach(): Promise<void> {
		if (this.disposed || this.reattaching || this.cancelReattach || !this.master || this.connectedAt === undefined) return Promise.resolve();
		if (this.clock.now() - this.connectedAt >= this.timeouts.stable) this.reattaches = 0;
		if (this.reattaches++ === 0) return this.attachAgain("its server restarted");
		const delay = reconnectDelay(this.reattaches - 2, this.options.random);
		this.options.log(`${this.alias}: its server restarted again; attaching again in ${Math.round(delay / 1000)} s.`);
		this.cancelReattach = this.clock.schedule(delay, () => {
			this.cancelReattach = undefined;
			void this.attachAgain("its server restarted");
		});
		return Promise.resolve();
	}

	/** Attach, forward a new port unless the old one still reaches it, and drop the old forwards, over the same master. */
	private async attachAgain(reason: string): Promise<void> {
		const env = this.env;
		const old = this.forwarded;
		const oldLanguage = this.language;
		if (this.disposed || this.reattaching || !this.master || this.connectedAt === undefined || !env || !old) return;
		const generation = this.generation;
		const stale = () => generation !== this.generation || this.disposed;
		this.reattaching = true;
		this.options.log(`${this.alias}: ${reason}; attaching again.`);
		try {
			const check = await this.run(sshCheckArgs(this.options.session, env), this.timeouts.operation);
			if (stale()) return;
			if (check.code !== 0) throw unreachable(`The SSH connection to ${this.alias} did not answer. ${firstLines(check.stderr)}`.trim());
			const attach = await this.attach(env);
			if (stale()) return;
			// The same server keeps its forward, so the gateway keeps the host online.
			const kept = attach.port === old.remote && (await probeHealth(old.local, this.timeouts.operation).then(() => true, () => false));
			if (stale()) return;
			if (kept) this.forwarded = old;
			const url = kept ? `http://127.0.0.1:${old.local}` : await this.forward(env, attach, stale);
			if (stale()) return;
			const language = await this.forwardLanguage(env, attach, stale);
			if (stale()) return;
			for (const forward of [kept ? undefined : old, oldLanguage]) {
				if (forward) await this.run(sshCancelForwardArgs(this.options.session, forward.local, forward.remote, env), this.timeouts.operation);
				if (stale()) return;
			}
			this.connectedAt = this.clock.now();
			this.serverId = attach.serverId;
			this.set({ alias: this.alias, endpoint: { url, token: attach.token }, ...language });
			this.whilePending(attach);
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

	/** Closes the forward and the master; the remote server keeps running. */
	async dispose(): Promise<void> {
		this.disposed = true;
		this.generation++;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.cancelPending?.();
		this.cancelPending = undefined;
		const master = this.master;
		this.master = undefined;
		await this.close(master);
	}

	/**
	 * The VS Code server of the machine `serverId`, when its commit matches and
	 * it answers through its forward now. One that stopped (its idle limit) is
	 * attached again, which starts a new one.
	 */
	async languageEndpoint(serverId: string): Promise<{ host: "127.0.0.1"; port: number; connectionToken: string } | undefined> {
		const language = this.language;
		if (!language || this.connectedAt === undefined || this.serverId !== serverId || this.reported.languageFeatures !== true) return undefined;
		const commit = await probeVersion(language.local, this.timeouts.operation).catch(() => undefined);
		if (commit === language.commit) return { host: "127.0.0.1", port: language.local, connectionToken: language.connectionToken };
		if (language === this.language) {
			this.options.log(`${this.alias}: its VS Code server did not answer; attaching again.`);
			void this.reattach();
		}
		return undefined;
	}

	/** An attach that found the extensions still installing is repeated, a bounded number of times. */
	private whilePending(attach: ReviewRemoteAttach): void {
		this.cancelPending?.();
		this.cancelPending = undefined;
		if (!attach.languageServerPending) {
			this.pendingAttaches = 0;
			return;
		}
		if (++this.pendingAttaches >= PENDING_ATTACHES) return;
		this.cancelPending = this.clock.schedule(PENDING_REATTACH_MS, () => {
			this.cancelPending = undefined;
			void this.attachAgain("its language extensions were installing");
		});
	}

	/** At process exit, when nothing can be awaited. */
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
		// A reattach waiting for its delay belongs to the connection being replaced.
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.cancelPending?.();
		this.cancelPending = undefined;
		this.connectedAt = undefined;
		this.promptCancelled = false;
		try {
			const env = await this.options.environment();
			if (stale()) return;
			this.env = env;
			await Promise.all(this.closing.values());
			// None of this host's masters runs now, but one killed by a signal left its socket, and ssh does not multiplex on a path that exists.
			await rm(this.options.session.controlPath, { force: true });
			if (stale()) return;
			const master = this.startMaster(env);
			await this.waitForMaster(master, env, stale);
			const attach = await this.attach(env);
			if (stale()) return;
			const url = await this.forward(env, attach, stale);
			if (stale()) return;
			const language = await this.forwardLanguage(env, attach, stale);
			if (stale()) return;
			this.connectedAt = this.clock.now();
			this.serverId = attach.serverId;
			// What authentication printed says nothing about why the connection may end later.
			this.masterStderr = "";
			this.set({ alias: this.alias, endpoint: { url, token: attach.token }, ...language });
			this.whilePending(attach);
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
		// The master's stderr carries forward failures too, so it is kept for as long as it runs.
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
		// An authenticated master cannot fail authentication: earlier prompts' text in its stderr says nothing now.
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
			// A check that answers after a dispose or retry must not let the attach run.
			if (stale()) throw unreachable("The SSH connection ended.");
			if (check.code === 0) return;
			// A prompt waits for the user, not for the network.
			if (this.prompts > 0) since = Date.now();
			if (Date.now() - since > this.timeouts.connect) {
				throw unreachable(`${this.alias} did not connect within ${this.timeouts.connect / 1000} seconds. ${firstLines(this.masterStderr)}`.trim());
			}
			await sleep(this.timeouts.poll);
		}
	}

	private async attach(env: NodeJS.ProcessEnv): Promise<ReviewRemoteAttach> {
		const script = reviewRemoteAttachScript((await this.options.groups?.()) ?? []);
		const result = await this.run(sshExecArgs(this.options.session, env), this.timeouts.attach, script);
		const parsed = parseRemoteAttach(result.stdout);
		if (parsed && "attach" in parsed) return parsed.attach;
		if (parsed) throw unreachable(`whiteboard remote attach failed on ${this.alias}: ${parsed.error}`);
		if (result.timedOut) throw unreachable(`whiteboard remote attach on ${this.alias} did not finish within ${this.timeouts.attach / 1000} seconds.`);
		if (result.code === 127) {
			const version = await this.options.desktopVersion();
			throw new HostFailure({
				state: "not-installed",
				detail: `Whiteboard is not installed on ${this.alias}. Install Whiteboard ${version} there; Node 24 is needed.`,
			});
		}
		throw unreachable(firstLines(result.stderr) || `whiteboard remote attach on ${this.alias} exited with code ${result.code ?? "none"}.`);
	}

	private async forward(env: NodeJS.ProcessEnv, attach: ReviewRemoteAttach, stale: () => boolean): Promise<string> {
		this.forwarded = undefined;
		const port = await this.options.freePort();
		if (stale()) throw unreachable("The SSH connection ended.");
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

	/**
	 * A second forward on the same master, to the VS Code server. Language
	 * features are unavailable, with the reason, when there is none, its commit
	 * differs from this Desktop's, or it does not answer; the review is not.
	 */
	private async forwardLanguage(env: NodeJS.ProcessEnv, attach: ReviewRemoteAttach, stale: () => boolean): Promise<LanguageFeatures> {
		this.language = undefined;
		const server = attach.languageServer;
		const unavailable = (detail: string): LanguageFeatures => ({ languageFeatures: false, languageFeaturesDetail: detail });
		if (!server) return unavailable(`Language features are unavailable on ${this.alias}: ${attach.languageServerDetail ?? "it has no VS Code server"}`);
		const mismatch = languageCommitMismatch(this.alias, server.commit, this.options.desktopCommit);
		if (mismatch) return unavailable(mismatch);
		const port = await this.options.freePort();
		if (stale()) throw unreachable("The SSH connection ended.");
		const forward = await this.run(sshForwardArgs(this.options.session, port, server.port, env), this.timeouts.operation);
		if (forward.code !== 0) return unavailable(`Could not forward a local port to the VS Code server on ${this.alias}: ${firstLines(forward.stderr) || `ssh exited with code ${forward.code}`}`);
		try {
			const commit = await probeVersion(port, this.timeouts.operation);
			if (commit !== server.commit) throw new Error(`it reports ${commit.slice(0, 40)}, not ${server.commit}`);
		} catch (error) {
			await this.run(sshCancelForwardArgs(this.options.session, port, server.port, env), this.timeouts.operation);
			return unavailable(`The VS Code server on ${this.alias} did not answer through the forward: ${(error as Error).message}.`);
		}
		this.language = { local: port, remote: server.port, connectionToken: server.connectionToken, commit: server.commit };
		return { languageFeatures: true };
	}

	private fail(problem: Problem): void {
		this.generation++;
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.cancelPending?.();
		this.cancelPending = undefined;
		this.connectedAt = undefined;
		this.dropMaster();
		this.set({ alias: this.alias, problem });
		// Retrying cannot fix a refused login or a missing install: wait for a retry or a setting change.
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
		this.language = undefined;
		void this.close(master);
	}

	/** `-O exit`, then SIGTERM if the master is still there. */
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
