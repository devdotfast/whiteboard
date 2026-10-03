/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { rm } from "node:fs/promises";
import { get } from "node:http";
import type { Readable, Writable } from "node:stream";
import type { ReviewGatewayHost, ReviewRemoteAgent, ReviewRemoteAgentResult } from "../../common/reviewProtocol.js";
import { isRemoteAgentId, parseRemoteAgents, parseRemoteConnect, plainText as plain, remoteConnectScript, type ReviewRemoteCli } from "./reviewRemoteAgents.js";
import { installedAttachScript, parseRemoteAttach, reviewRemoteAttachScript, type ReviewRemoteAttach } from "./reviewRemoteAttachScript.js";
import type { ReviewRemoteInstallConsent } from "./reviewRemoteInstallConsent.js";
import type { ReviewRemoteInstallInput, ReviewRemoteInstallResult } from "./reviewRemoteInstaller.js";
import { judgeRemote, probeRemote, type ReviewRemoteProbe, type ReviewRemoteTarget } from "./reviewRemoteProbe.js";
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
	/** `whiteboard connect --detect`, login shell included. */
	agents: 10_000,
	/** `whiteboard connect --yes`, per agent: the CLI bounds each agent's commands to 120 s. */
	agentConnect: 130_000,
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

/** The optional groups the remote reported, when this Desktop asked for any. */
const groupsOf = ({ languageGroups }: ReviewRemoteAttach): Pick<ReviewGatewayHost, "languageGroups"> =>
	languageGroups.length > 0 ? { languageGroups: [...languageGroups] } : {};

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

/** `review.remote.install`. */
export type ReviewRemoteInstallMode = "ask" | "always" | "never";

export type ReviewRemoteInstallRunInput = Pick<ReviewRemoteInstallInput, "session" | "probe" | "target" | "version" | "onProgress" | "signal" | "spawn" | "env">;

/** Desktop installs its own version on a host before it attaches. */
export interface ReviewRemoteInstallFlow {
	mode(): ReviewRemoteInstallMode;
	readonly consent: ReviewRemoteInstallConsent;
	/** Asks the user: true installs, false declines, undefined (no answer, or cancelled) decides nothing. */
	confirm(request: { alias: string; text: string; signal?: AbortSignal }): Promise<boolean | undefined>;
	/** Closes the host's open or queued question, unanswered. */
	cancel?(alias: string): void;
	/** `installRemote` with this build's artifacts. */
	run(input: ReviewRemoteInstallRunInput): Promise<ReviewRemoteInstallResult>;
	/** The integrity of the package this build installs; a version is installed only with it. */
	integrity(): Promise<string>;
}

type InstallStep = NonNullable<ReviewGatewayHost["installing"]>["step"];

/** The attach command for the optional extension groups this Desktop has enabled. */
type AttachScript = (groups: readonly string[]) => string;

/** What a step was doing, for a failure's detail. */
const STEP_WORDS: Record<InstallStep, string> = {
	preparing: "preparing",
	"waiting-for-lock": "waiting for another install",
	node: "installing Node",
	package: "installing the package",
	verifying: "checking the install",
	done: "finishing",
};

const VIA = { "remote-download": "downloaded on the host", upload: "uploaded from this computer" } as const;

/**
 * Sizes from installs on Linux: the package 0.2.0 with its dependencies
 * (734 MB on arm64, 777 MB on x64), and Node 24 unpacked. Paths are written as `~`: the remote's text never shapes the question.
 */
export function installPromptText(alias: string, version: string, probe: ReviewRemoteProbe): string {
	const node = probe.node || probe.managedNode ? "" : `, and about 200 MB for Node 24, which ${alias} does not have`;
	const where = probe.root === `${probe.home}/.dev/whiteboard-remote` ? "~/.dev/whiteboard-remote" : "whiteboard-remote under DEV_REVIEW_HOME";
	return `Whiteboard ${version} is not installed on ${alias}. Install it in ${where}? It takes about 800 MB${node}. Whiteboard also adds ~/.local/bin/whiteboard if that path is free.`;
}

/** One sentence naming the version, the step and the reason; the installer's own errors name the step more closely. */
export function installFailureText(alias: string, version: string, step: InstallStep, message: string): string {
	const said = /^Installing on .+? failed( while .+?)?: ([\s\S]*)$/.exec(message);
	const what = said ? (said[1] ?? "") : ` while ${STEP_WORDS[step]}`;
	return plain(`Installing Whiteboard ${version} on ${alias} failed${what}: ${said ? said[2] : message}`);
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
	/** Without it, or with `never`, the CLI the user installed is attached through PATH. */
	readonly install?: ReviewRemoteInstallFlow;
	/** True the first time this Desktop attaches to a server (its id, else the alias): its agents are read then. */
	firstAttach?(key: string): boolean;
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
	private reattaching = false;
	/** A reattach the gateway asked for while another was running; it runs next. */
	private queuedReattach = false;
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
	/** What attaches: stage 1's script, or the installed version's CLI. */
	private attachScript: AttachScript = reviewRemoteAttachScript;
	/** The installed version's CLI; the one on PATH when unset. */
	private cli: ReviewRemoteCli;
	/** The agents the connected server's machine has, once read. */
	private agents: ReviewRemoteAgent[] | undefined;
	private detecting: Promise<ReviewRemoteAgent[] | undefined> | undefined;
	/** The user has not agreed to the install: Settings offers it. */
	private declined = false;
	/** This Desktop's version failed to install; an older one attached. */
	private installFailure: string | undefined;
	private installing: AbortController | undefined;
	/** An uninstall runs over the master: nothing connects, attaches again or installs. */
	private removing = false;
	/** The server id of the last attach. */
	serverId: string | undefined;

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
		if (this.disposed || this.removing) return;
		this.generation++;
		this.failures = 0;
		this.pendingAttaches = 0;
		this.dropMaster();
		this.declined = false;
		this.installFailure = undefined;
		this.set({ alias: this.alias });
		void this.connect();
	}

	/**
	 * After sleep: a host waiting to retry connects now. A connected host is
	 * probed through its forward, because `-O check` answers from local state
	 * while the TCP session may be dead; if it does not answer, the master is replaced.
	 */
	async resume(): Promise<void> {
		if (this.disposed || this.removing) return;
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
		if (this.disposed || this.removing || this.cancelReattach || !this.master || this.connectedAt === undefined) return Promise.resolve();
		// Never dropped: the attach running may have read the remote before it restarted.
		if (this.reattaching) {
			this.queuedReattach = true;
			return Promise.resolve();
		}
		if (this.clock.now() - this.connectedAt >= this.timeouts.stable) this.reattaches = 0;
		if (this.reattaches++ === 0) return this.attachAgain("its server restarted", false);
		const delay = reconnectDelay(this.reattaches - 2, this.options.random);
		this.options.log(`${this.alias}: its server restarted again; attaching again in ${Math.round(delay / 1000)} s.`);
		this.cancelReattach = this.clock.schedule(delay, () => {
			this.cancelReattach = undefined;
			void this.attachAgain("its server restarted", false);
		});
		return Promise.resolve();
	}

	/**
	 * Attach, forward new ports and drop the old forwards, over the same
	 * master. Only an attach this Desktop starts itself (`reuse`) may keep a
	 * review forward that still reaches the same port: the gateway stops
	 * checking a host it asked to reattach until it sees a new endpoint.
	 */
	private async attachAgain(reason: string, reuse: boolean): Promise<void> {
		const env = this.env;
		const old = this.forwarded;
		const oldLanguage = this.language;
		if (this.disposed || this.removing || this.reattaching || !this.master || this.connectedAt === undefined || !env || !old) return;
		const generation = this.generation;
		const stale = () => generation !== this.generation || this.disposed;
		this.reattaching = true;
		this.options.log(`${this.alias}: ${reason}; attaching again.`);
		try {
			const check = await this.run(sshCheckArgs(this.options.session, env), this.timeouts.operation);
			if (stale()) return;
			if (check.code !== 0) throw unreachable(`The SSH connection to ${this.alias} did not answer. ${firstLines(check.stderr)}`.trim());
			const attach = await this.attach(env, this.attachScript);
			if (stale()) return;
			// The same server keeps its forward, so the gateway keeps the host online.
			const kept = reuse && attach.port === old.remote && (await probeHealth(old.local, this.timeouts.operation).then(() => true, () => false));
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
			this.serverId = attach.serverId ?? undefined;
			this.set({ alias: this.alias, endpoint: { url, token: attach.token }, ...language, ...groupsOf(attach), ...this.facts() });
			this.whilePending(attach);
		} catch (error) {
			if (stale()) return;
			this.fail(error instanceof HostFailure ? error.problem : { state: "unreachable", detail: (error as Error).message });
		} finally {
			this.reattaching = false;
			if (this.queuedReattach) {
				this.queuedReattach = false;
				void this.reattach();
			}
		}
	}

	/**
	 * Before an uninstall over the master, which stays up: what is under way
	 * stops, and nothing reconnects, attaches again or installs until `unquiesce`.
	 */
	quiesce(): void {
		this.removing = true;
		this.generation++;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.cancelPending?.();
		this.cancelPending = undefined;
		this.installing?.abort();
		this.options.install?.cancel?.(this.alias);
	}

	get quiesced(): boolean {
		return this.removing;
	}

	/** The uninstall failed and the host stays: it connects afresh. */
	unquiesce(): void {
		this.removing = false;
		this.retry();
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
		this.options.install?.cancel?.(this.alias);
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.cancelPending?.();
		this.cancelPending = undefined;
		this.installing?.abort();
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
			void this.attachAgain("its VS Code server did not answer", true);
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
			void this.attachAgain("its language extensions were installing", true);
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
		if (this.removing) return;
		const generation = ++this.generation;
		const stale = () => generation !== this.generation || this.disposed;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		// A reattach waiting for its delay belongs to the connection being replaced.
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.cancelPending?.();
		this.cancelPending = undefined;
		this.queuedReattach = false;
		this.connectedAt = undefined;
		this.promptCancelled = false;
		this.declined = false;
		this.installFailure = undefined;
		this.agents = undefined;
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
			const prepared = await this.prepareAttach(env, stale);
			if (prepared === undefined) return;
			const attach = await this.attach(env, prepared.script);
			if (stale()) return;
			const url = await this.forward(env, attach, stale);
			if (stale()) return;
			const language = await this.forwardLanguage(env, attach, stale);
			if (stale()) return;
			this.attachScript = prepared.script;
			this.cli = prepared.cli;
			this.connectedAt = this.clock.now();
			// What authentication printed says nothing about why the connection may end later.
			this.masterStderr = "";
			this.set({ alias: this.alias, endpoint: { url, token: attach.token }, ...language, ...groupsOf(attach), ...this.facts() });
			this.whilePending(attach);
			const serverId = attach.serverId;
			this.serverId = serverId ?? undefined;
			if (serverId) void this.options.install?.consent.attached(this.alias, serverId).catch((error: Error) => this.options.log(`${this.alias}: could not keep its install consent: ${error.message}`));
			// Reading changes nothing on the host; Settings offers what it finds.
			if (this.options.firstAttach?.(serverId ?? `alias:${this.alias}`)) void this.detectAgents();
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
		// The question was about a host this Desktop no longer reaches.
		this.options.install?.cancel?.(this.alias);
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

	/**
	 * The script that attaches, or undefined once stale. With installs off,
	 * stage 1's, which finds a CLI the user installed. Otherwise the host is
	 * probed; without this version installed or on PATH, the user is asked,
	 * this Desktop's version installed beside any other, and that version's
	 * CLI attaches by its path.
	 */
	private async prepareAttach(env: NodeJS.ProcessEnv, stale: () => boolean): Promise<{ script: AttachScript; cli?: ReviewRemoteCli } | undefined> {
		const onPath = { script: reviewRemoteAttachScript };
		const flow = this.options.install;
		const mode = flow?.mode() ?? "never";
		if (!flow || mode === "never") return onPath;
		const probed = await probeRemote({ session: this.options.session, spawn: this.options.spawn, env });
		if (stale()) return;
		if ("error" in probed) throw unreachable(probed.error);
		const support = judgeRemote(probed.probe);
		if (!support.supported) throw new HostFailure({ state: "unsupported", detail: support.reason });
		const version = await this.options.desktopVersion();
		// Only a listed version needs this build's integrity, which a development build packs for.
		const integrity = probed.probe.installed.some((entry) => entry.version === version)
			? await flow.integrity().catch((error: Error) => void this.options.log(`${this.alias}: no package integrity to compare: ${error.message}`))
			: undefined;
		if (stale()) return;
		// Another pack under the same version is not this build's: it is installed again, as any absent version.
		const present = probed.probe.installed.some((entry) => entry.version === version && entry.integrity === integrity);
		if (!present && probed.probe.pathCli?.version === version) return { script: (groups) => reviewRemoteAttachScript(groups, true) };
		if (!present && mode === "ask" && !(await this.agreed(flow, probed.probe, version, stale))) {
			// A CLI the user installed by hand still attaches; without one the host is not-installed.
			this.declined = true;
			return stale() ? undefined : onPath;
		}
		if (stale()) return;
		const installed = await this.install(flow, env, probed.probe, support.target, version, present, stale);
		if (!installed) return undefined;
		if ("path" in installed) {
			const { nodePath, cliPath } = installed.path;
			return { script: (groups) => installedAttachScript(nodePath, cliPath, groups), cli: { nodePath, cliPath } };
		}
		// An older complete version still serves: attached as it is, so the host is incompatible and says why.
		if (!probed.probe.installed.some((other) => other.version !== version)) throw new HostFailure({ state: "not-installed", detail: installed.failed });
		this.installFailure = installed.failed;
		return onPath;
	}

	/** Asks once per host; an answer is kept, a prompt nobody answered is not. */
	private async agreed(flow: ReviewRemoteInstallFlow, probe: ReviewRemoteProbe, version: string, stale: () => boolean): Promise<boolean> {
		const log = (error: Error) => this.options.log(`${this.alias}: install consent: ${error.message}`);
		const stored = await flow.consent.get(this.alias).catch(log);
		if (stored) return stored === "allow";
		this.set({ alias: this.alias, asking: version });
		const answer = await flow.confirm({ alias: this.alias, text: installPromptText(this.alias, version, probe) });
		if (!stale()) this.set({ alias: this.alias });
		// A replaced connection's answer is the new one's too: the question is shared, so it is written once.
		if (answer !== undefined && !stale()) await flow.consent.set(this.alias, answer ? "allow" : "deny").catch(log);
		return answer === true;
	}

	/** Installs `version`, or only checks it when `present`; undefined once stale, or why it failed. */
	private async install(
		flow: ReviewRemoteInstallFlow,
		env: NodeJS.ProcessEnv,
		probe: ReviewRemoteProbe,
		target: ReviewRemoteTarget,
		version: string,
		present: boolean,
		stale: () => boolean,
	): Promise<{ path: ReviewRemoteInstallResult } | { failed: string } | undefined> {
		const abort = new AbortController();
		this.installing = abort;
		let step: InstallStep = "preparing";
		// A version already there is only checked: it shows as installing only if it is installed again.
		if (!present) this.set({ alias: this.alias, installing: { step } });
		try {
			const path = await flow.run({
				session: this.options.session,
				probe,
				target,
				version,
				spawn: this.options.spawn,
				env,
				signal: abort.signal,
				onProgress: (progress) => {
					if (stale()) return;
					step = progress.step;
					if (step === "done" && !this.reported.installing) return;
					this.set({ alias: this.alias, installing: { step, ...("via" in progress && { detail: VIA[progress.via] }) } });
				},
			});
			return { path };
		} catch (error) {
			if (stale()) return undefined;
			const message = (error as Error).message;
			// ssh exits 255 when the connection drops.
			if (/\bexit 255\b/.test(message) || !this.master || gone(this.master)) {
				throw unreachable(`The connection to ${this.alias} dropped while installing Whiteboard ${version} (${STEP_WORDS[step]}).`);
			}
			return { failed: installFailureText(this.alias, version, step, message) };
		} finally {
			if (this.installing === abort) this.installing = undefined;
		}
	}

	/** The agents on the host, read once per connection; undefined while it is not online, or when they could not be read. */
	detectAgents(): Promise<ReviewRemoteAgent[] | undefined> {
		if (this.agents) return Promise.resolve(this.agents);
		return (this.detecting ??= this.readAgents().finally(() => (this.detecting = undefined)));
	}

	private async readAgents(): Promise<ReviewRemoteAgent[] | undefined> {
		const env = this.env;
		if (this.disposed || !this.master || this.connectedAt === undefined || !env) return undefined;
		const generation = this.generation;
		const result = await this.run(sshExecArgs(this.options.session, env), this.timeouts.agents, remoteConnectScript(this.cli, ["--detect", "--json"]));
		if (generation !== this.generation || this.disposed) return undefined;
		const agents = parseRemoteAgents(result.stdout);
		if (!agents) {
			this.options.log(`${this.alias}: could not read its agents: ${result.timedOut ? `no answer within ${this.timeouts.agents / 1000} seconds` : plain(firstLines(result.stderr)) || `exit ${result.code ?? "none"}`}.`);
			return undefined;
		}
		return (this.agents = agents);
	}

	/** Runs `whiteboard connect --yes` for agents the host was found to have, and that need no person. */
	async connectAgents(ids: readonly unknown[]): Promise<ReviewRemoteAgentResult[]> {
		const known = await this.detectAgents();
		if (!known) throw new Error(`${this.alias} is not connected, or its agents could not be read.`);
		const wanted = [...new Set(ids)];
		for (const id of wanted) {
			if (!isRemoteAgentId(id) || !known.some((agent) => agent.id === id && !agent.manual)) {
				throw new Error(`Whiteboard cannot connect ${isRemoteAgentId(id) ? id : "that agent"} on ${this.alias}.`);
			}
		}
		const env = this.env;
		if (!wanted.length) return [];
		if (!this.master || !env) throw new Error(`The connection to ${this.alias} dropped; connect again to connect its agents.`);
		const generation = this.generation;
		const result = await this.run(sshExecArgs(this.options.session, env), this.timeouts.agentConnect * wanted.length, remoteConnectScript(this.cli, ["--yes", "--json", ...(wanted as string[])]));
		const results = parseRemoteConnect(result.stdout);
		if (!results) {
			throw new Error(
				`Connecting agents on ${this.alias} failed: ${result.timedOut ? "it did not finish in time" : plain(firstLines(result.stderr)) || `exit ${result.code ?? "none"}`}`,
			);
		}
		if (generation === this.generation && this.agents) {
			this.agents = this.agents.map((agent) => ({ ...agent, connected: results.find((done) => done.id === agent.id)?.connected ?? agent.connected }));
		}
		return results;
	}

	private async attach(env: NodeJS.ProcessEnv, script: AttachScript): Promise<ReviewRemoteAttach> {
		const groups = (await this.options.groups?.()) ?? [];
		const result = await this.run(sshExecArgs(this.options.session, env), this.timeouts.attach, script(groups));
		const parsed = parseRemoteAttach(result.stdout);
		if (parsed && "attach" in parsed) {
			const { incompatibleRunning, replaced } = parsed.attach;
			if (incompatibleRunning) {
				throw new HostFailure({
					state: "incompatible",
					detail:
						incompatibleRunning.startedBy === "user"
							? `A Whiteboard server ${incompatibleRunning.version} started by a user is running on ${this.alias}; stop it to use this Desktop's version.`
							: `A newer Whiteboard ${incompatibleRunning.version} is running on ${this.alias}, started by ${incompatibleRunning.startedBy === "cli" ? "the CLI" : "another Desktop"}; update this Desktop to use it.`,
				});
			}
			if (replaced) this.options.log(`${this.alias}: replaced its Whiteboard server ${replaced} with ${parsed.attach.version}.`);
			// Only the groups this Desktop asked for, once each.
			const languageGroups = parsed.attach.languageGroups.filter(
				(entry, index, all) => groups.includes(entry.group) && all.findIndex((other) => other.group === entry.group) === index,
			);
			return { ...parsed.attach, languageGroups };
		}
		if (parsed) throw unreachable(`whiteboard remote attach failed on ${this.alias}: ${parsed.error}`);
		if (result.timedOut) throw unreachable(`whiteboard remote attach on ${this.alias} did not finish within ${this.timeouts.attach / 1000} seconds.`);
		if (result.code === 127) {
			const version = await this.options.desktopVersion();
			throw new HostFailure({
				state: "not-installed",
				detail: this.installFailure ?? `Whiteboard is not installed on ${this.alias}. Install Whiteboard ${version} there; Node 24 is needed.`,
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
		// Settings says "Language features: unavailable — " before it.
		if (!server) return unavailable(attach.languageServerDetail ?? "This host has no VS Code server.");
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

	/** What this connection adds to an endpoint: no consent, or a failed upgrade. */
	private facts(): Pick<ReviewGatewayHost, "declined" | "installFailure"> {
		return { ...(this.declined && { declined: true as const }), ...(this.installFailure && { installFailure: this.installFailure }) };
	}

	private fail(problem: Problem): void {
		this.generation++;
		this.queuedReattach = false;
		this.cancelReattach?.();
		this.cancelReattach = undefined;
		this.cancelPending?.();
		this.cancelPending = undefined;
		this.connectedAt = undefined;
		this.dropMaster();
		this.set({ alias: this.alias, problem, ...(this.declined && { declined: true as const }) });
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
		this.installing?.abort();
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
