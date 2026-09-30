/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// Test support for the remote host tests: an `ssh` whose remotes are scripted.

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ReviewRemoteClock, SpawnSsh, SshChildProcess } from "./reviewRemoteHost.js";

class FakeChild extends EventEmitter {
	static nextPid = 1000;
	readonly pid = FakeChild.nextPid++;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
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
	attach?: { code: number; stdout?: string; stderr?: string };
	remotePort?: number;
}

export interface FakeCall {
	readonly alias: string;
	readonly kind: "master" | "check" | "exec" | "forward" | "cancel" | "exit";
	readonly args: readonly string[];
	readonly at: number;
}

export const attachOutput = (port: number, token = "remote-token") =>
	`WHITEBOARD-REMOTE-BEGIN\n${JSON.stringify({ event: "remote.attach", version: "0.1.6", commit: "abc", serverId: "s1", url: `http://127.0.0.1:${port}`, token, startedServer: true, diffr: true })}\nWHITEBOARD-REMOTE-END\n`;

/** A virtual clock: scheduled work runs only when the test calls `next`. */
export function fakeClock() {
	let time = 0;
	let pending: { at: number; run(): void }[] = [];
	const clock: ReviewRemoteClock & { next(): boolean; readonly pending: number; delays: number[] } = {
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
		calls.push({ alias, kind, args, at: clock?.now() ?? Date.now() });
		const master = masters.get(alias);
		setImmediate(() => {
			if (kind === "master") {
				masters.set(alias, child);
				const how = typeof remote.master === "function" ? remote.master(alias) : (remote.master ?? "up");
				if (how === "up") up.add(child);
				else if (how === "missing") child.emit("error", Object.assign(new Error("spawn ssh ENOENT"), { code: "ENOENT" }));
				else if (how !== "hang") child.finish(how.code, { stderr: how.stderr });
			} else if (kind === "check") {
				child.finish(master && master.alive && up.has(master) ? 0 : 255, master?.alive ? {} : { stderr: "Control socket connect: No such file or directory\n" });
			} else if (kind === "exec") {
				const answer = () => {
					const attach = remote.attach ?? { code: 0, stdout: attachOutput(remote.remotePort ?? 41234) };
					child.finish(attach.code, attach);
				};
				if (child.stdin.writableFinished) answer();
				else child.stdin.once("finish", answer);
			} else if (kind === "exit") {
				child.finish(master?.alive ? 0 : 255, { stderr: "Exit request sent.\n" });
				master?.finish(255);
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
