/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import type { ReviewGatewayHost, ReviewGatewayHostState, ReviewRemoteAgent, ReviewRemoteAgentResult } from "../../common/reviewProtocol.js";
import {
	REVIEW_REMOTE_TIMEOUTS,
	ReviewRemoteHost,
	runSsh,
	systemClock,
	type ReviewRemoteClock,
	type ReviewRemoteHostOptions,
	type ReviewRemoteInstallFlow,
	type SpawnSsh,
} from "./reviewRemoteHost.js";
import type { ReviewSshAskpass, SshPromptRequest } from "./reviewSshAskpass.js";
import { uninstallRemote } from "./reviewRemoteUninstall.js";
import {
	prepareSshControlDirectory,
	reviewSshInstancePrefix,
	reviewSshSession,
	sshCloseArgs,
	validateSshAlias,
} from "./reviewSshCommand.js";

/** The gateway restarts a first check when hosts arrive faster than this. */
const SEND_INTERVAL_MS = 1_000;

export interface ReviewRemoteHostsOptions {
	readonly spawn: SpawnSsh;
	readonly controlDirectory: string;
	/** Keeps this Desktop's control sockets apart from another Desktop's. */
	readonly instance?: string;
	/** The environment every ssh starts from; askpass is added per alias. */
	environment(): Promise<NodeJS.ProcessEnv>;
	createAskpass(input: {
		directory: string;
		prompt(request: SshPromptRequest): Promise<string | undefined>;
		log(message: string): void;
	}): Promise<ReviewSshAskpass>;
	/** Shows a prompt; `undefined` is a cancel. */
	prompt(request: SshPromptRequest): Promise<string | undefined>;
	desktopVersion(): Promise<string>;
	readonly desktopCommit?: string;
	groups?(): Promise<readonly string[]>;
	freePort?(): Promise<number>;
	/** Hands the whole list to the local server. */
	send(hosts: ReviewGatewayHost[]): void;
	log(message: string): void;
	readonly clock?: ReviewRemoteClock;
	readonly timeouts?: ReviewRemoteHostOptions["timeouts"];
	/** Desktop installs its version on each host; without it, hosts need the CLI installed by hand. */
	readonly install?: ReviewRemoteInstallFlow;
}

export function freeLoopbackPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

/**
 * Every alias in the setting, each connecting on its own. Sends the local
 * server the whole list, in the setting's order, at most once a second.
 */
export class ReviewRemoteHosts {
	private readonly clock: ReviewRemoteClock;
	private readonly hosts = new Map<string, ReviewRemoteHost>();
	/** Removed from the setting, still closing, with the promise of its close. */
	private readonly closing = new Map<ReviewRemoteHost, Promise<void>>();
	/** Uninstalls under way, by alias: a second request joins the first. */
	private readonly uninstalling = new Map<string, Promise<void>>();
	/** Aliases Whiteboard was removed from, until they leave the setting. */
	private readonly removed = new Set<string>();
	/** Aliases refused before reaching ssh. */
	private readonly refused = new Map<string, ReviewGatewayHost>();
	private order: string[] = [];
	private prepared: Promise<ReviewSshAskpass> | undefined;
	private cancelSend: (() => void) | undefined;
	private lastSent = -Infinity;
	private sentAny = false;
	private disposed = false;
	private disposing: Promise<void> | undefined;
	/** Servers whose agents this session has read. */
	private readonly agentsRead = new Set<string>();

	/**
	 * The install flow, asking one question at a time: a window shows one
	 * prompt, and a second would dismiss the first. A host has one question
	 * at most; asking again joins it.
	 */
	private readonly flow: ReviewRemoteInstallFlow | undefined;

	constructor(private readonly options: ReviewRemoteHostsOptions) {
		this.clock = options.clock ?? systemClock;
		const flow = options.install;
		let asking: Promise<unknown> = Promise.resolve();
		const questions = new Map<string, { answer: Promise<boolean | undefined>; abort: AbortController }>();
		this.flow = flow && {
			...flow,
			confirm: (request) => {
				const open = questions.get(request.alias);
				if (open) return open.answer;
				const abort = new AbortController();
				const answer = asking
					.then(() => (abort.signal.aborted ? undefined : flow.confirm({ ...request, signal: abort.signal })))
					.finally(() => questions.get(request.alias)?.abort === abort && questions.delete(request.alias));
				asking = answer.catch(() => undefined);
				questions.set(request.alias, { answer, abort });
				return answer;
			},
			// The next request asks afresh: a cancelled question, shown or queued, is never joined.
			cancel: (alias) => {
				questions.get(alias)?.abort.abort();
				questions.delete(alias);
			},
		};
	}

	/** Connects added aliases and closes removed ones. Returns at once. */
	update(enabled: boolean, aliases: readonly string[]): void {
		if (this.disposed) return;
		const wanted = enabled ? [...new Set(aliases)] : [];
		for (const [alias, host] of this.hosts) {
			if (wanted.includes(alias)) continue;
			this.hosts.delete(alias);
			this.options.log(`${alias}: removed from the setting; closing its connection.`);
			this.closing.set(host, host.dispose().finally(() => this.closing.delete(host)));
		}
		this.order = wanted;
		this.refused.clear();
		for (const alias of this.removed) if (!wanted.includes(alias)) this.removed.delete(alias);
		for (const alias of wanted) {
			if (this.removed.has(alias)) continue;
			const valid = validateSshAlias(alias);
			if (!valid.ok) {
				this.refused.set(alias, { alias, problem: { state: "unreachable", detail: `The SSH alias ${JSON.stringify(alias)} ${valid.reason}.` } });
				continue;
			}
			const existing = this.hosts.get(alias);
			// A changed setting is the user's cue to try a refused login or a missing install again.
			if (existing) {
				// Its uninstall failed, and the alias stays; one still running keeps it quiesced, and the next change decides.
				if (existing.quiesced) {
					if (!this.uninstalling.has(alias)) existing.unquiesce();
				} else if (existing.state.problem && existing.state.problem.state !== "unreachable") existing.retry();
				continue;
			}
			const host = this.createHost(alias);
			this.hosts.set(alias, host);
			// The same alias still closing uses the same socket path, which the new host would unlink under it.
			const previous = [...this.closing].filter(([old]) => old.state.alias === alias).map(([, closed]) => closed);
			if (previous.length) void Promise.all(previous).then(() => this.hosts.get(alias) === host && host.start());
			else host.start();
		}
		this.publish();
	}

	retry(alias: string): void {
		const host = this.hosts.get(alias);
		if (host?.quiesced && !this.uninstalling.has(alias)) host.unquiesce();
		else host?.retry();
	}

	/** The user agreed to the install on a host declined earlier. */
	async install(alias: string): Promise<void> {
		await this.options.install?.consent.set(alias, "allow");
		this.hosts.get(alias)?.retry();
	}

	/** The kept agents of an online host, read now if they are not. */
	detectAgents(alias: string): Promise<ReviewRemoteAgent[] | undefined> {
		return this.hosts.get(alias)?.detectAgents() ?? Promise.resolve(undefined);
	}

	connectAgents(alias: string, ids: readonly unknown[]): Promise<ReviewRemoteAgentResult[]> {
		const host = this.hosts.get(alias);
		if (!host) return Promise.reject(new Error(`${alias} is not a remote host in Settings.`));
		return host.connectAgents(ids);
	}

	/**
	 * Runs the host's own uninstall, keeping reviews, over its master while
	 * nothing may reconnect or install; then forgets the install answer and
	 * closes the host. After a failure the host waits, quiesced, for Settings,
	 * which removes the alias; one kept in the setting connects afresh.
	 */
	uninstall(alias: string): Promise<void> {
		const running = this.uninstalling.get(alias);
		if (running) return running;
		const done = this.uninstallOnce(alias).finally(() => this.uninstalling.delete(alias));
		this.uninstalling.set(alias, done);
		return done;
	}

	private async uninstallOnce(alias: string): Promise<void> {
		const valid = validateSshAlias(alias);
		if (!valid.ok) throw new Error(`The SSH alias ${JSON.stringify(alias)} ${valid.reason}.`);
		const host = this.hosts.get(alias);
		host?.quiesce();
		try {
			const env = { ...(await this.options.environment()), ...(await this.askpass()).env(alias) };
			await uninstallRemote({ session: reviewSshSession(alias, this.options.controlDirectory, this.options.instance), spawn: this.options.spawn, env });
		} catch (error) {
			this.options.log(`${alias}: Whiteboard was not removed; the host waits for the setting.`);
			throw error;
		}
		await this.options.install?.consent.forget(alias, host?.serverId);
		if (host && this.hosts.get(alias) === host) {
			this.hosts.delete(alias);
			this.removed.add(alias);
			this.publish();
		}
		if (!host) return;
		// Removed from the setting meanwhile, it is closing already.
		let closed = this.closing.get(host);
		if (!closed) {
			closed = host.dispose().finally(() => this.closing.delete(host));
			this.closing.set(host, closed);
		}
		await closed;
	}

	/** The local server saw the host's server restart with a new token. */
	reattach(alias: string): void {
		void this.hosts.get(alias)?.reattach();
	}

	/**
	 * The forwarded VS Code server of the machine `serverId`, through the
	 * first alias the gateway has online for it, when it has language features.
	 */
	async languageEndpoint(serverId: string, states: readonly ReviewGatewayHostState[]): ReturnType<ReviewRemoteHost["languageEndpoint"]> {
		const online = states.find((state) => state.serverId === serverId && state.state === "online");
		return online && this.hosts.get(online.alias)?.languageEndpoint(serverId);
	}

	/** After sleep, every host is checked at once. */
	resume(): void {
		for (const host of this.hosts.values()) void host.resume();
	}

	/** Closes every forward and master; remote servers keep running. */
	dispose(): Promise<void> {
		return (this.disposing ??= (async () => {
			this.disposed = true;
			this.cancelSend?.();
			const hosts = [...this.hosts.values()];
			this.hosts.clear();
			// A closing host was disposed already; its close is what is left to wait for.
			await Promise.all([...hosts.map((host) => host.dispose()), ...this.closing.values()]);
			(await this.prepared?.catch(() => undefined))?.dispose();
		})());
	}

	/** At process exit, when nothing can be awaited: masters are detached and would outlive us. */
	killNow(): void {
		for (const host of [...this.hosts.values(), ...this.closing.keys()]) host.killNow();
	}

	private createHost(alias: string): ReviewRemoteHost {
		return new ReviewRemoteHost({
			session: reviewSshSession(alias, this.options.controlDirectory, this.options.instance),
			spawn: this.options.spawn,
			environment: async () => ({ ...(await this.options.environment()), ...(await this.askpass()).env(alias) }),
			desktopVersion: () => this.options.desktopVersion(),
			desktopCommit: this.options.desktopCommit,
			groups: this.options.groups,
			freePort: this.options.freePort ?? freeLoopbackPort,
			report: () => this.publish(),
			log: this.options.log,
			clock: this.clock,
			timeouts: this.options.timeouts,
			install: this.flow,
			firstAttach: (key) => !this.agentsRead.has(key) && !!this.agentsRead.add(key),
		});
	}

	/** One control directory and one askpass for the process, made on first use. */
	private askpass(): Promise<ReviewSshAskpass> {
		return (this.prepared ??= (async () => {
			await prepareSshControlDirectory(this.options.controlDirectory);
			await this.sweepOrphans();
			return this.options.createAskpass({
				directory: this.options.controlDirectory,
				prompt: (request) => this.prompt(request),
				log: this.options.log,
			});
		})());
	}

	/** Masters a crashed run of this Desktop left, for any alias: each is asked to exit, and its socket removed. */
	/** Best effort: a failure is logged and never keeps a host from connecting. */
	private async sweepOrphans(): Promise<void> {
		if (this.options.instance === undefined) return;
		const prefix = reviewSshInstancePrefix(this.options.instance);
		try {
			const env = await this.options.environment();
			for (const name of await readdir(this.options.controlDirectory)) {
				if (!name.startsWith(prefix)) continue;
				const controlPath = join(this.options.controlDirectory, name);
				try {
					// -O exit works on any socket; the alias after -- is only a placeholder.
					const closed = await runSsh(this.options.spawn, env, sshCloseArgs({ alias: "orphan", controlPath }, env), REVIEW_REMOTE_TIMEOUTS.close);
					if (closed.code === 0) this.options.log(`closed an SSH connection left by an earlier run (${name}).`);
					await rm(controlPath, { force: true });
				} catch (error) {
					this.options.log(`could not remove ${name} from the SSH control directory: ${(error as Error).message}`);
				}
			}
		} catch (error) {
			this.options.log(`could not sweep the SSH control directory: ${(error as Error).message}`);
		}
	}

	private async prompt(request: SshPromptRequest): Promise<string | undefined> {
		const host = this.hosts.get(request.alias);
		host?.promptOpened();
		let answered = true;
		try {
			const answer = await this.options.prompt(request);
			answered = answer !== undefined;
			return answer;
		} finally {
			host?.promptClosed(answered);
		}
	}

	private publish(): void {
		if (this.disposed || this.cancelSend || (!this.sentAny && !this.order.length)) return;
		const wait = Math.max(0, this.lastSent + SEND_INTERVAL_MS - this.clock.now());
		this.cancelSend = this.clock.schedule(wait, () => {
			this.cancelSend = undefined;
			this.lastSent = this.clock.now();
			this.sentAny = true;
			this.options.send(this.order.flatMap((alias) => this.refused.get(alias) ?? this.hosts.get(alias)?.state ?? []));
		});
	}
}
