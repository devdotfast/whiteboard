/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// Test support for the remote host tests: an `ssh` whose remotes are scripted.

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ReviewRemoteClock, SpawnSsh, SshChildProcess } from "./reviewRemoteHost.js";
import { REVIEW_REMOTE_INSTALL_SAY } from "./reviewRemoteInstallScript.js";
import { REVIEW_REMOTE_PROBE_BEGIN, REVIEW_REMOTE_PROBE_END } from "./reviewRemoteProbeScript.js";

class FakeChild extends EventEmitter {
	static nextPid = 1000;
	readonly pid = FakeChild.nextPid++;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	exitedAt: number | undefined;
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	input = "";

	constructor() {
		super();
		this.stdin.setEncoding("utf8").on("data", (chunk: string) => (this.input += chunk));
	}

	get alive() {
		return this.exitCode === null && this.signalCode === null;
	}

	finish(code: number | null, output: { stdout?: string; stderr?: string } = {}, signal: NodeJS.Signals | null = null) {
		if (!this.alive) return;
		if (output.stdout) this.stdout.write(output.stdout);
		if (output.stderr) this.stderr.write(output.stderr);
		this.stdout.end();
		this.stderr.end();
		setImmediate(() => {
			this.exitCode = code;
			this.signalCode = signal;
			this.exitedAt = Date.now();
			this.emit("exit", code, signal);
			this.emit("close", code, signal);
		});
	}

	kill(signal: NodeJS.Signals = "SIGTERM") {
		this.finish(null, {}, signal);
		return true;
	}
}

type MasterOutcome = "up" | "hang" | "missing" | { code: number; stderr: string };

export interface FakeRemote {
	/** How a new master ends up: up (the default), a failure right away, or never answering. */
	master?: MasterOutcome | ((alias: string) => MasterOutcome);
	/** The answer to `sh -s`; a function answers each exec in turn (1, 2, ...). */
	attach?: Attach | ((call: number) => Attach);
	/** The answer to the probe script; a supported host with nothing installed by default. */
	probe?: Partial<Record<string, unknown>>;
	remotePort?: number;
	/** Written by an up master as it starts, as a prompt's retries leave it. */
	masterStderr?: string;
	/** How long an up master takes to exit after -O exit. */
	exitDelayMs?: number;
	/** Each `-O check` (1, 2, ...) answers as the master was when asked, once this settles. */
	checkAnswered?: (call: number) => Promise<unknown> | undefined;
	/** The answer to `whiteboard connect --detect`; no agents by default. */
	detect?: Attach;
	/** The answer to `whiteboard connect --yes`; every agent asked for connected by default. */
	connect?: Attach;
	/** `remote uninstall` of 0.1.6 answers `ok`, once `after` settles. */
	uninstall?: { ok: boolean; after?: Promise<unknown> };
}

type Attach = { code: number; stdout?: string; stderr?: string };

export interface FakeCall {
	readonly alias: string;
	/** An exec is a `probe` once its script shows it is one. */
	kind: "master" | "check" | "exec" | "probe" | "detect" | "connect" | "uninstall" | "forward" | "cancel" | "exit";
	readonly args: readonly string[];
	/** What an exec got on stdin. */
	input?: string;
	readonly at: number;
	/** Real time, for ordering against a child's `exitedAt`. */
	readonly wall: number;
}

export const FAKE_SERVER_ID = "0199a3f2-7c1e-7d4a-9b2f-3e5d6c7b8a90";

export const detectOutput = (agents: readonly Record<string, unknown>[]) => `${JSON.stringify({ event: "connect.detect", agents })}\n`;

/** `connect --yes` connecting the agents its script names. */
const connectedOutput = (input: string) =>
	`${JSON.stringify({ event: "connect.run", agents: [...input.matchAll(/'(claude|codex|opencode|pi)'/g)].map(([, id]) => ({ id, name: id, connected: true, output: "" })) })}\n`;

export const attachOutput = (port: number, token = "remote-token", extra: Record<string, unknown> = {}) =>
	`WHITEBOARD-REMOTE-BEGIN\n${JSON.stringify({ event: "remote.attach", version: "0.1.6", commit: "abc", serverId: FAKE_SERVER_ID, url: `http://127.0.0.1:${port}`, token, startedServer: true, diffr: true, ...extra })}\nWHITEBOARD-REMOTE-END\n`;

/** A supported Linux host with no Node and nothing installed, unless `probe` says otherwise. */
export const probeOutput = (probe: Partial<Record<string, unknown>> = {}) =>
	`${REVIEW_REMOTE_PROBE_BEGIN}\n${JSON.stringify({
		os: "Linux",
		arch: "aarch64",
		glibc: "2.35",
		home: "/home/dev",
		root: "/home/dev/.dev/whiteboard-remote",
		homeWritable: true,
		freeBytes: 50e9,
		node: null,
		npm: null,
		installed: [],
		managedNode: null,
		downloader: "curl",
		registryReachable: true,
		tools: ["tar", "xz", "sha256sum", "sha512sum"],
		...probe,
	})}\n${REVIEW_REMOTE_PROBE_END}\n`;

/** A virtual clock: scheduled work runs only when the test calls `next`. */
export function fakeClock() {
	let time = 0;
	let pending: { at: number; run(): void }[] = [];
	const clock: ReviewRemoteClock & { next(): boolean; advance(ms: number): void; readonly pending: number; delays: number[] } = {
		delays: [],
		now: () => time,
		schedule(ms, run) {
			clock.delays.push(ms);
			const entry = { at: time + ms, run };
			pending.push(entry);
			return () => void (pending = pending.filter((e) => e !== entry));
		},
		next() {
			pending.sort((a, b) => a.at - b.at);
			const entry = pending.shift();
			if (!entry) return false;
			time = Math.max(time, entry.at);
			entry.run();
			return true;
		},
		/** Time passes with nothing due; scheduled work still waits for `next`. */
		advance(ms) {
			time += ms;
		},
		get pending() {
			return pending.length;
		},
	};
	return clock;
}

export function fakeSsh(remotes: Record<string, FakeRemote>, clock?: { now(): number }) {
	const calls: FakeCall[] = [];
	const masters = new Map<string, FakeChild>();
	const up = new Set<FakeChild>();

	const spawn: SpawnSsh = (args) => {
		const child = new FakeChild();
		const alias = args[args.indexOf("--") + 1];
		const remote = remotes[alias] ?? {};
		const operation = args.includes("-O") ? args[args.indexOf("-O") + 1] : undefined;
		const kind: FakeCall["kind"] = args.includes("-M") ? "master" : args.at(-1) === "-s" ? "exec" : (operation as FakeCall["kind"]);
		const entry: FakeCall = { alias, kind, args, at: clock?.now() ?? Date.now(), wall: Date.now() };
		calls.push(entry);
		const master = masters.get(alias);
		setImmediate(() => {
			if (kind === "master") {
				masters.set(alias, child);
				const how = typeof remote.master === "function" ? remote.master(alias) : (remote.master ?? "up");
				if (how === "up") {
					up.add(child);
					if (remote.masterStderr) child.stderr.write(remote.masterStderr);
				}
				else if (how === "missing") child.emit("error", Object.assign(new Error("spawn ssh ENOENT"), { code: "ENOENT" }));
				else if (how !== "hang") child.finish(how.code, { stderr: how.stderr });
			} else if (kind === "check") {
				const code = master && master.alive && up.has(master) ? 0 : 255;
				const output = master?.alive ? {} : { stderr: "Control socket connect: No such file or directory\n" };
				const call = calls.filter((c) => c.alias === alias && c.kind === "check").length;
				void Promise.resolve(remote.checkAnswered?.(call)).then(() => child.finish(code, output));
			} else if (kind === "exec") {
				const answer = () => {
					entry.input = child.input;
					if (child.input.includes(REVIEW_REMOTE_PROBE_BEGIN)) {
						entry.kind = "probe";
						return child.finish(0, { stdout: probeOutput(remote.probe) });
					}
					if (child.input.includes("'connect' '--detect'")) {
						entry.kind = "detect";
						const answer = remote.detect ?? { code: 0, stdout: detectOutput([]) };
						return child.finish(answer.code, answer);
					}
					if (child.input.includes("'connect' '--yes'")) {
						entry.kind = "connect";
						const answer = remote.connect ?? { code: 0, stdout: connectedOutput(child.input) };
						return child.finish(answer.code, answer);
					}
					if (child.input.includes(" LISTED\\n")) {
						entry.kind = "uninstall";
						return child.finish(0, { stdout: `${REVIEW_REMOTE_INSTALL_SAY} ROOT /home/dev/.dev/whiteboard-remote\n${REVIEW_REMOTE_INSTALL_SAY} HAVE 0.1.6\n${REVIEW_REMOTE_INSTALL_SAY} LISTED\n` });
					}
					if (child.input.includes("remote uninstall")) {
						entry.kind = "uninstall";
						const done = () => child.finish(0, { stdout: `${JSON.stringify({ event: "remote.uninstall", ok: remote.uninstall?.ok ?? true, reason: "refused" })}\n` });
						return void (remote.uninstall?.after ?? Promise.resolve()).then(done);
					}
					const call = calls.filter((c) => c.alias === alias && c.kind === "exec").length;
					const attach =
						typeof remote.attach === "function"
							? remote.attach(call)
							: (remote.attach ?? { code: 0, stdout: attachOutput(remote.remotePort ?? 41234) });
					child.finish(attach.code, attach);
				};
				if (child.stdin.writableFinished) answer();
				else child.stdin.once("finish", answer);
			} else if (kind === "exit") {
				const listening = master !== undefined && master.alive && up.has(master);
				child.finish(listening ? 0 : 255, { stderr: listening ? "Exit request sent.\n" : "Control socket connect: No such file or directory\n" });
				if (listening) setTimeout(() => master.finish(255), remote.exitDelayMs ?? 0);
			} else child.finish(master?.alive ? 0 : 255);
		});
		return child as unknown as SshChildProcess;
	};

	return {
		spawn,
		calls,
		of: (alias: string, kind?: FakeCall["kind"]) => calls.filter((c) => c.alias === alias && (!kind || c.kind === kind)),
		master: (alias: string) => masters.get(alias),
		/** The master keeps running but stops answering on its socket. */
		wedge: (alias: string) => void up.delete(masters.get(alias)!),
		alive: () => [...masters.values()].filter((m) => m.alive).length,
	};
}

export async function until(condition: () => boolean, ms = 3000) {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}
