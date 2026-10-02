/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ReviewGatewayHost } from "../../common/reviewProtocol.js";
import { attachOutput, detectOutput, FAKE_SERVER_ID, fakeClock, fakeSsh, until, type FakeRemote } from "./reviewRemoteFakeSsh.js";
import {
	classifySshFailure,
	languageCommitMismatch,
	reconnectDelay,
	ReviewRemoteHost,
	type ReviewRemoteHostOptions,
	type ReviewRemoteInstallFlow,
	type ReviewRemoteInstallMode,
	type ReviewRemoteInstallRunInput,
} from "./reviewRemoteHost.js";
import { openRemoteInstallConsent } from "./reviewRemoteInstallConsent.js";
import type { ReviewRemoteInstallProgress, ReviewRemoteInstallResult } from "./reviewRemoteInstaller.js";
import { reviewSshSession } from "./reviewSshCommand.js";

/** Stands in for the forwarded port: the probe reaches it through real HTTP. */
async function healthServer(t: test.TestContext, servers?: Server[]): Promise<number> {
	const server: Server = createServer((_request, response) => response.end('{"ok":true}'));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(() => resolve(undefined))));
	servers?.push(server);
	return (server.address() as AddressInfo).port;
}

/** Stands in for the forwarded VS Code server: `/version` answers `commit`. */
async function versionServer(t: test.TestContext, commit: string): Promise<number> {
	const server: Server = createServer((request, response) => response.end(request.url === "/version" ? commit : ""));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(() => resolve(undefined))));
	return (server.address() as AddressInfo).port;
}

const COMMIT = "a".repeat(40);

const NO_SERVER = { languageFeatures: false, languageFeaturesDetail: "The Whiteboard on this host has no VS Code server." };

/** `ports` are handed out in turn as the free local ports. Without `install`, the stage 1 flow: installs are off. */
function hostFor(
	t: test.TestContext,
	remote: FakeRemote,
	ports: number | number[] | (() => Promise<number>),
	alias = "wb-test-a",
	controlDirectory = "/tmp/wb-ssh-test",
	install?: ReviewRemoteInstallFlow,
	version = "0.1.6",
	extra: Partial<ReviewRemoteHostOptions> = {},
) {
	const free = typeof ports === "function" ? [] : [ports].flat();
	let next = 0;
	const clock = fakeClock();
	const ssh = fakeSsh({ [alias]: remote }, clock);
	const reports: ReviewGatewayHost[] = [];
	const host = new ReviewRemoteHost({
		session: reviewSshSession(alias, controlDirectory),
		spawn: ssh.spawn,
		environment: async () => ({ PATH: "/usr/bin" }),
		desktopVersion: async () => version,
		groups: async () => ["go"],
		freePort: typeof ports === "function" ? ports : async () => free[next++ % free.length],
		report: (state) => reports.push(state),
		log: () => {},
		clock,
		timeouts: { poll: 1 },
		install,
		...extra,
	});
	t.after(() => host.dispose());
	return { host, ssh, clock, reports, last: () => reports.at(-1) };
}

/** This build's package integrity. */
const INTEGRITY = `sha512-${"A".repeat(86)}==`;
const at = (version: string, integrity = INTEGRITY) => ({ version, integrity });

const INSTALLED: ReviewRemoteInstallResult = {
	nodePath: "/home/dev/.dev/whiteboard-remote/node/v24.18.0/bin/node",
	cliPath: "/home/dev/.dev/whiteboard-remote/versions/0.1.6/node_modules/@dev.fast/whiteboard/dist/cli.js",
	launcher: "/home/dev/.dev/whiteboard-remote/versions/0.1.6/whiteboard",
	diffr: true,
};

/**
 * Desktop's install, with the installer replaced: `steps` are reported, then
 * it answers `INSTALLED`, or throws `fails`. Consent is a real file.
 */
async function installFlow(
	t: test.TestContext,
	mode: ReviewRemoteInstallMode,
	options: {
		answers?: (boolean | undefined)[];
		steps?: ReviewRemoteInstallProgress[];
		fails?: (call: number) => Error | undefined;
		consentFile?: string;
	} = {},
) {
	const dir = await mkdtemp(join(tmpdir(), "wb-flow-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const consentFile = options.consentFile ?? join(dir, "consent.json");
	const prompts: { alias: string; text: string }[] = [];
	const runs: ReviewRemoteInstallRunInput[] = [];
	const answers = [...(options.answers ?? [])];
	const flow: ReviewRemoteInstallFlow = {
		mode: () => mode,
		consent: openRemoteInstallConsent(consentFile),
		confirm: async (request) => {
			prompts.push(request);
			return answers.shift();
		},
		run: async (input) => {
			runs.push(input);
			for (const step of options.steps ?? [{ step: "done", cliPath: INSTALLED.cliPath }]) input.onProgress(step);
			const error = options.fails?.(runs.length);
			if (error) throw error;
			return INSTALLED;
		},
		integrity: async () => INTEGRITY,
	};
	return { flow, prompts, runs, consentFile };
}

const STEPS: ReviewRemoteInstallProgress[] = [
	{ step: "node", via: "upload" },
	{ step: "package", via: "remote-download" },
	{ step: "verifying" },
	{ step: "done", cliPath: INSTALLED.cliPath },
];

test("a successful attach reports an endpoint at the forwarded port", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, last } = hostFor(t, { remotePort: 41234 }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last(), { alias: "wb-test-a", endpoint: { url: `http://127.0.0.1:${port}`, token: "remote-token" }, ...NO_SERVER });
	const [forward] = ssh.of("wb-test-a", "forward");
	assert.ok(forward.args.includes(`127.0.0.1:${port}:127.0.0.1:41234`));
	// The master answered -O check before the script ran through it.
	const kinds = ssh.calls.map((c) => c.kind);
	assert.ok(kinds.indexOf("check") < kinds.indexOf("exec"));
});

test("the VS Code server gets a second forward on the same master, and only its endpoint reaches a window", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, COMMIT)];
	const languageServer = { port: 45678, connectionToken: "vscode-token", commit: COMMIT };
	const { host, ssh, last } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "remote-token", { languageServer }) } }, ports);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last(), { alias: "wb-test-a", endpoint: { url: `http://127.0.0.1:${ports[0]}`, token: "remote-token" }, languageFeatures: true });
	assert.equal(ssh.of("wb-test-a", "master").length, 1);
	const forwards = ssh.of("wb-test-a", "forward").map((call) => call.args.find((arg) => arg.startsWith("127.0.0.1:")));
	assert.deepEqual(forwards, [`127.0.0.1:${ports[0]}:127.0.0.1:41234`, `127.0.0.1:${ports[1]}:127.0.0.1:45678`]);
	assert.deepEqual(await host.languageEndpoint(FAKE_SERVER_ID), { host: "127.0.0.1", port: ports[1], connectionToken: "vscode-token" });
	assert.equal(await host.languageEndpoint("another machine"), undefined);
	assert.doesNotMatch(JSON.stringify(last()), /vscode-token/);
});

test("the Desktop's enabled groups go to remote attach", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, last } = hostFor(t, {}, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.match(ssh.of("wb-test-a", "exec")[0].input!, /exec "\$wb" remote attach --json --groups go\n$/);
});

test("the remote's language groups reach the gateway: well-formed, asked for by this Desktop, once each", async (t) => {
	const port = await healthServer(t);
	const languageGroups = [
		{ group: "Not A Group", installed: true },
		{ group: "go" },
		"go",
		{ group: "python", installed: true },
		{ group: "go", installed: true, detail: "x".repeat(900) },
		{ group: "go", installed: false, detail: "a second go" },
	];
	const stdout = `WHITEBOARD-REMOTE-BEGIN\n${JSON.stringify({ event: "remote.attach", serverId: FAKE_SERVER_ID, url: `http://127.0.0.1:${port}`, token: "remote-token", languageServer: null, languageServerDetail: "none", languageGroups })}\nWHITEBOARD-REMOTE-END\n`;
	const { host, last } = hostFor(t, { attach: { code: 0, stdout } }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last()?.languageGroups, [{ group: "go", installed: true, detail: "x".repeat(500) }]);
});

test("a VS Code server of another commit leaves the review online without language features", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, COMMIT)];
	const languageServer = { port: 45678, connectionToken: "vscode-token", commit: COMMIT };
	const { host, ssh, last } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "remote-token", { languageServer }) } }, ports, "wb-test-a", "/tmp/wb-ssh-test", undefined, undefined, { desktopCommit: "b".repeat(40) });

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last(), {
		alias: "wb-test-a",
		endpoint: { url: `http://127.0.0.1:${ports[0]}`, token: "remote-token" },
		languageFeatures: false,
		languageFeaturesDetail: "language features need the same Whiteboard version on wb-test-a: it runs aaaaaaa, this Desktop bbbbbbb",
	});
	assert.equal(ssh.of("wb-test-a", "forward").length, 1);
	assert.equal(await host.languageEndpoint(FAKE_SERVER_ID), undefined);
});

test("a dev Desktop, with no commit, accepts any VS Code server; a release Desktop only its own", () => {
	assert.equal(languageCommitMismatch("a", COMMIT, undefined), undefined);
	assert.equal(languageCommitMismatch("a", COMMIT, COMMIT), undefined);
	assert.match(languageCommitMismatch("a", COMMIT, "b".repeat(40))!, /on a: it runs aaaaaaa, this Desktop bbbbbbb$/);
});

test("a VS Code server that does not answer through its forward is unavailable, and its forward is cancelled", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, "c".repeat(40))];
	const languageServer = { port: 45678, connectionToken: "vscode-token", commit: COMMIT };
	const { host, ssh, last } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "remote-token", { languageServer }) } }, ports);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(last()?.languageFeatures, false);
	assert.match(last()!.languageFeaturesDetail!, /did not answer through the forward: it reports c{40}, not a{40}\.$/);
	const cancels = ssh.of("wb-test-a", "cancel");
	assert.equal(cancels.length, 1);
	assert.ok(cancels[0].args.includes(`127.0.0.1:${ports[1]}:127.0.0.1:45678`));
	assert.equal(await host.languageEndpoint(FAKE_SERVER_ID), undefined);
});

test("a reattach drops both old forwards", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, COMMIT), await healthServer(t), await versionServer(t, COMMIT)];
	const { host, ssh, last } = hostFor(
		t,
		{ attach: (call) => ({ code: 0, stdout: attachOutput(41234 + call, `token-${call}`, { languageServer: { port: 45678 + call, connectionToken: `vscode-${call}`, commit: COMMIT } }) }) },
		ports,
	);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	await host.reattach();

	assert.equal(last()?.endpoint?.token, "token-2");
	assert.equal(ssh.of("wb-test-a", "forward").length, 4);
	assert.deepEqual(
		ssh.of("wb-test-a", "cancel").map((call) => call.args.find((arg) => arg.startsWith("127.0.0.1:"))),
		[`127.0.0.1:${ports[0]}:127.0.0.1:41235`, `127.0.0.1:${ports[1]}:127.0.0.1:45679`],
	);
	assert.deepEqual(await host.languageEndpoint(FAKE_SERVER_ID), { host: "127.0.0.1", port: ports[3], connectionToken: "vscode-2" });
});

const PENDING_DETAIL = "Installing the language extensions on this host; they will be available on the next connection.";

/** An attach whose remote is still installing its language extensions. */
const pendingOutput = (port: number) =>
	`WHITEBOARD-REMOTE-BEGIN\n${JSON.stringify({ event: "remote.attach", version: "0.1.6", commit: "abc", serverId: FAKE_SERVER_ID, url: `http://127.0.0.1:${port}`, token: "remote-token", startedServer: false, diffr: true, languageServer: null, languageServerDetail: PENDING_DETAIL, languageServerPending: true })}\nWHITEBOARD-REMOTE-END\n`;

test("a VS Code server that stopped answering is not handed out, and the host attaches again", async (t) => {
	const stopped: Server = createServer((request, response) => response.end(request.url === "/version" ? COMMIT : ""));
	await new Promise<void>((resolve) => stopped.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => stopped.close(() => resolve(undefined))));
	const ports = [await healthServer(t), (stopped.address() as AddressInfo).port, await versionServer(t, COMMIT)];
	const { host, ssh, last } = hostFor(
		t,
		{ attach: (call) => ({ code: 0, stdout: attachOutput(41234, "remote-token", { languageServer: { port: 45677 + call, connectionToken: `vscode-${call}`, commit: COMMIT } }) }) },
		ports,
	);

	host.start();
	await until(() => last()?.languageFeatures === true);
	await new Promise((resolve) => stopped.close(resolve));

	assert.equal(await host.languageEndpoint(FAKE_SERVER_ID), undefined);
	await until(() => ssh.of("wb-test-a", "exec").length === 2 && ssh.of("wb-test-a", "cancel").length === 1);
	assert.deepEqual(await host.languageEndpoint(FAKE_SERVER_ID), { host: "127.0.0.1", port: ports[2], connectionToken: "vscode-2" });
	// The review server did not change: its forward and endpoint stay.
	assert.equal(last()?.endpoint?.url, `http://127.0.0.1:${ports[0]}`);
	assert.deepEqual(
		ssh.of("wb-test-a", "cancel").map((call) => call.args.find((arg) => arg.startsWith("127.0.0.1:"))),
		[`127.0.0.1:${ports[1]}:127.0.0.1:45678`],
	);
});

test("a reattach the gateway asks for opens a new review forward, even to the same server", async (t) => {
	const ports = [await healthServer(t), await healthServer(t)];
	const { host, ssh, last } = hostFor(t, {}, ports);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	// A transient reset: the same port and token answer again.
	await host.reattach();

	assert.equal(last()?.endpoint?.url, `http://127.0.0.1:${ports[1]}`);
	assert.equal(last()?.endpoint?.token, "remote-token");
	assert.equal(ssh.of("wb-test-a", "forward").length, 2);
	assert.ok(ssh.of("wb-test-a", "cancel")[0].args.includes(`127.0.0.1:${ports[0]}:127.0.0.1:41234`));
});

test("a reattach the gateway asks for during a pending attach runs after it, with new forwards", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, COMMIT), await healthServer(t), await versionServer(t, COMMIT)];
	const { host, ssh, clock, last } = hostFor(
		t,
		{ attach: (call) => ({ code: 0, stdout: call === 1 ? pendingOutput(41234) : attachOutput(41234, "remote-token", { languageServer: { port: 45678, connectionToken: `vscode-${call}`, commit: COMMIT } }) }) },
		ports,
	);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	assert.ok(clock.next());
	// The pending attach is running; the gateway's request must not be lost.
	await host.reattach();
	await until(() => ssh.of("wb-test-a", "exec").length === 3 && last()?.endpoint?.url === `http://127.0.0.1:${ports[2]}`);

	assert.equal(last()?.languageFeatures, true);
	assert.deepEqual(await host.languageEndpoint(FAKE_SERVER_ID), { host: "127.0.0.1", port: ports[3], connectionToken: "vscode-3" });
});

test("a Retry after ten pending attaches attaches again on the same schedule", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, clock, last } = hostFor(t, { attach: { code: 0, stdout: pendingOutput(41234) } }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	for (let attaches = 1; attaches < 10; attaches++) {
		await until(() => clock.pending === 1);
		clock.next();
		await until(() => ssh.of("wb-test-a", "exec").length === attaches + 1);
	}
	// The tenth attach schedules nothing.
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(clock.pending, 0);

	host.retry();
	await until(() => ssh.of("wb-test-a", "exec").length === 11 && last()?.endpoint !== undefined);
	await until(() => clock.pending === 1);
	assert.equal(clock.delays.at(-1), 60_000);
});

test("a remote still installing its extensions is attached again after a minute, until its VS Code server is reported", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, COMMIT)];
	const { host, ssh, clock, last } = hostFor(
		t,
		{ attach: (call) => ({ code: 0, stdout: call === 1 ? pendingOutput(41234) : attachOutput(41234, "remote-token", { languageServer: { port: 45678, connectionToken: "vscode-token", commit: COMMIT } }) }) },
		ports,
	);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last(), {
		alias: "wb-test-a",
		endpoint: { url: `http://127.0.0.1:${ports[0]}`, token: "remote-token" },
		languageFeatures: false,
		languageFeaturesDetail: PENDING_DETAIL,
	});
	assert.equal(clock.pending, 1);
	assert.equal(clock.delays.at(-1), 60_000);
	assert.ok(clock.next());
	await until(() => last()?.languageFeatures === true);

	assert.equal(last()?.endpoint?.url, `http://127.0.0.1:${ports[0]}`);
	assert.equal(ssh.of("wb-test-a", "exec").length, 2);
	assert.equal(clock.pending, 0);
});

test("attaching again for a pending install stops after ten attaches in a row", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, clock, last } = hostFor(t, { attach: { code: 0, stdout: pendingOutput(41234) } }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	for (let attaches = 1; attaches < 10; attaches++) {
		await until(() => clock.pending === 1);
		clock.next();
		await until(() => ssh.of("wb-test-a", "exec").length === attaches + 1);
	}
	// The tenth attach schedules nothing.
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(clock.pending, 0);

	assert.equal(ssh.of("wb-test-a", "exec").length, 10);
	assert.equal(last()?.languageFeaturesDetail, PENDING_DETAIL);
	assert.equal(last()?.endpoint?.url, `http://127.0.0.1:${port}`);
});

test("output with a banner before the first sentinel still parses", async (t) => {
	const port = await healthServer(t);
	const banner = "Welcome to Ubuntu 22.04\n\nLast login: yesterday\nnvm: using node 24";
	const { host, last } = hostFor(t, { attach: { code: 0, stdout: `${banner}${attachOutput(41234, "t2")}bye\n` } }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(last()?.endpoint?.token, "t2");
});

test("exit 127 from the script is not-installed, naming the version to install", async (t) => {
	const { host, clock, last } = hostFor(t, { attach: { code: 127 } }, 1);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.equal(last()?.problem?.state, "not-installed");
	assert.match(last()!.problem!.detail, /Install Whiteboard 0\.1\.6 there/);
	assert.doesNotMatch(last()!.problem!.detail, /npm install/);
	assert.match(last()!.problem!.detail, /Node 24/);
	assert.equal(clock.pending, 0);
});

test("a cancelled prompt is auth-failed, and there is no second attempt", async (t) => {
	const { host, ssh, clock, last } = hostFor(t, { master: "hang" }, 1);

	host.start();
	await until(() => ssh.master("wb-test-a") !== undefined);
	host.promptOpened();
	host.promptClosed(false);
	ssh.master("wb-test-a")!.finish(255, {
		stderr: "Warning: Permanently added '[127.0.0.1]:2222' (ED25519) to the list of known hosts.\ndev@127.0.0.1: Permission denied (publickey,password).\n",
	});
	await until(() => last()?.problem !== undefined);

	assert.equal(last()?.problem?.state, "auth-failed");
	assert.equal(last()!.problem!.detail, "dev@127.0.0.1: Permission denied (publickey,password).");
	assert.equal(clock.pending, 0);
	assert.equal(ssh.of("wb-test-a", "master").length, 1);
});

test("OpenSSH's authentication and host key refusals are auth-failed; the rest unreachable", () => {
	assert.equal(classifySshFailure("u@h: Permission denied (publickey).", false), "auth-failed");
	assert.equal(classifySshFailure("Host key verification failed.", false), "auth-failed");
	assert.equal(classifySshFailure("@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @", false), "auth-failed");
	assert.equal(classifySshFailure("Connection closed by 10.0.0.1 port 22", true), "auth-failed");
	assert.equal(classifySshFailure("ssh: connect to host h port 22: Connection refused", false), "unreachable");
});

test("the master exits and the host reconnects after the backoff", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, clock, last } = hostFor(t, {}, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	ssh.master("wb-test-a")!.finish(255, { stderr: "Connection to 127.0.0.1 closed by remote host.\n" });
	await until(() => last()?.problem !== undefined);

	assert.equal(last()?.problem?.state, "unreachable");
	assert.match(last()!.problem!.detail, /closed by remote host/);
	assert.equal(ssh.of("wb-test-a", "master").length, 1);
	assert.ok(clock.next());
	await until(() => last()?.endpoint !== undefined);
	assert.equal(ssh.of("wb-test-a", "master").length, 2);
	assert.ok(clock.delays[0] >= 1000 && clock.delays[0] <= 1250);
});

test("a master killed by a signal leaves its socket, and the next master does not find it", async (t) => {
	const port = await healthServer(t);
	const dir = await mkdtemp(join(tmpdir(), "wb-ssh-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const { host, ssh, clock, last } = hostFor(t, {}, port, "wb-test-a", dir);
	const socket = reviewSshSession("wb-test-a", dir).controlPath;

	host.start();
	await until(() => last()?.endpoint !== undefined);
	await writeFile(socket, "");
	ssh.master("wb-test-a")!.kill("SIGKILL");
	await until(() => last()?.problem !== undefined);
	assert.ok(clock.next());
	await until(() => last()?.endpoint !== undefined);

	assert.equal(ssh.of("wb-test-a", "master").length, 2);
	assert.equal(existsSync(socket), false);
});

test("ten failures in a row are never less than 1 s apart, and the delay never exceeds 60 s", async (t) => {
	const { host, ssh, clock } = hostFor(t, { master: { code: 255, stderr: "ssh: connect to host 127.0.0.1 port 22: Connection refused\n" } }, 1);

	host.start();
	for (let attempt = 1; attempt < 10; attempt++) {
		await until(() => clock.pending === 1);
		assert.ok(clock.next());
		await until(() => ssh.of("wb-test-a", "master").length === attempt + 1);
	}

	const times = ssh.of("wb-test-a", "master").map((c) => c.at);
	for (let i = 1; i < times.length; i++) {
		assert.ok(times[i] - times[i - 1] >= 1000, `attempts ${i - 1} and ${i} are ${times[i] - times[i - 1]} ms apart`);
	}
	assert.ok(clock.delays.every((ms) => ms >= 1000 && ms <= 60_000));
	// The last delays are at the cap, less its jitter.
	assert.ok(Math.max(...clock.delays) >= 45_000);
});

test("the backoff grows with jitter within 1 s and 60 s", () => {
	for (let failures = 0; failures < 12; failures++) {
		for (const random of [0, 0.5, 0.999]) {
			const delay = reconnectDelay(failures, () => random);
			assert.ok(delay >= 1000 && delay <= 60_000);
		}
	}
	assert.ok(reconnectDelay(3, () => 0) < reconnectDelay(3, () => 0.999));
});

test("a resume reconnects at once, without waiting for the backoff", async (t) => {
	let masters = 0;
	const port = await healthServer(t);
	const { host, ssh, clock, last } = hostFor(
		t,
		{ master: () => (++masters === 1 ? { code: 255, stderr: "Network is unreachable\n" } : "up") },
		port,
	);

	host.start();
	await until(() => clock.pending === 1);
	await host.resume();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(ssh.of("wb-test-a", "master").length, 2);
	assert.equal(clock.pending, 0);
});

test("a resume replaces a master whose forward no longer answers", async (t) => {
	const servers: Server[] = [];
	const ports = [await healthServer(t, servers), await healthServer(t, servers)];
	const { host, ssh, clock, last } = hostFor(t, {}, ports);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	const first = ssh.master("wb-test-a")!;
	// -O check still answers: only the HTTP path through the forward is dead.
	servers[0].closeAllConnections();
	await new Promise((resolve) => servers[0].close(resolve));
	await host.resume();

	await until(() => last()?.endpoint?.url === `http://127.0.0.1:${ports[1]}`);
	assert.equal(ssh.of("wb-test-a", "master").length, 2);
	assert.equal(first.alive, false);
	assert.equal(clock.pending, 0);
});

test("a resume leaves a host whose forward answers alone", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, last } = hostFor(t, {}, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	await host.resume();

	assert.equal(ssh.of("wb-test-a", "master").length, 1);
});

test("an authenticated master that ends is unreachable and retried, whatever its prompts left in stderr", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, clock, last } = hostFor(t, { masterStderr: "Permission denied, please try again.\n" }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	ssh.master("wb-test-a")!.finish(255, { stderr: "Connection reset by peer\n" });
	await until(() => last()?.problem !== undefined);

	assert.equal(last()?.problem?.state, "unreachable");
	assert.equal(last()!.problem!.detail, "The SSH connection to wb-test-a ended: Connection reset by peer");
	assert.equal(clock.pending, 1);
});

test("a restarted remote server is attached again over the same master", async (t) => {
	const ports = [await healthServer(t), await healthServer(t)];
	const { host, ssh, last } = hostFor(
		t,
		{ attach: (call) => ({ code: 0, stdout: attachOutput(41234 + call, `token-${call}`) }) },
		ports,
	);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	await host.reattach();

	assert.deepEqual(last(), { alias: "wb-test-a", endpoint: { url: `http://127.0.0.1:${ports[1]}`, token: "token-2" }, ...NO_SERVER });
	assert.equal(ssh.of("wb-test-a", "master").length, 1);
	assert.equal(ssh.of("wb-test-a", "forward").length, 2);
	const cancels = ssh.of("wb-test-a", "cancel");
	assert.equal(cancels.length, 1);
	assert.ok(cancels[0].args.includes(`127.0.0.1:${ports[0]}:127.0.0.1:41235`));
});

test("a server that keeps restarting is attached again with growing delays, until a stable period", async (t) => {
	const ports = [await healthServer(t), await healthServer(t)];
	const { host, ssh, clock, last } = hostFor(
		t,
		{ attach: (call) => ({ code: 0, stdout: attachOutput(41234 + call, `token-${call}`) }) },
		ports,
	);
	const execs = () => ssh.of("wb-test-a", "exec");

	host.start();
	await until(() => last()?.endpoint !== undefined);
	await host.reattach();
	assert.equal(execs().length, 2);
	for (let call = 3; call <= 4; call++) {
		await host.reattach();
		assert.equal(clock.pending, 1);
		assert.ok(clock.next());
		await until(() => last()?.endpoint?.token === `token-${call}`);
	}

	const [, first, second, third] = execs().map((c) => c.at);
	assert.ok(second - first >= 1000, `${second - first} ms`);
	assert.ok(third - second > second - first, `${third - second} ms after ${second - first} ms`);

	clock.advance(30_000);
	await host.reattach();
	assert.equal(execs().length, 5);
	assert.equal(clock.pending, 0);
	assert.equal(last()?.endpoint?.token, "token-5");
});

test("a retry drops a reattach waiting for its delay, and reattach is accepted again", async (t) => {
	const port = await healthServer(t);
	const { host, clock, last } = hostFor(t, {}, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	await host.reattach();
	await host.reattach();
	assert.equal(clock.pending, 1);
	host.retry();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(clock.pending, 0);
	await host.reattach();
	assert.equal(clock.pending, 1);
});

test("a retry starts the new master only after the old one has exited", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, last } = hostFor(t, { exitDelayMs: 150 }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	const first = ssh.master("wb-test-a")!;
	host.retry();
	await until(() => ssh.of("wb-test-a", "master").length === 2);

	assert.ok(first.exitedAt !== undefined && ssh.of("wb-test-a", "master")[1].wall >= first.exitedAt);
});

test("the sentinels are found after a banner longer than the output bound", async (t) => {
	const port = await healthServer(t);
	const banner = `${"motd ".repeat(20 * 1024)}\n`;
	const { host, last } = hostFor(t, { attach: { code: 0, stdout: `${banner}${attachOutput(41234, "late")}` } }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(last()?.endpoint?.token, "late");
});

test("ssh missing from PATH is unreachable and says OpenSSH is needed", async (t) => {
	const { host, last } = hostFor(t, { master: "missing" }, 1);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.equal(last()?.problem?.state, "unreachable");
	assert.match(last()!.problem!.detail, /OpenSSH is needed/);
});

test("dispose closes the master with -O exit", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, last } = hostFor(t, {}, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	await host.dispose();

	assert.equal(ssh.of("wb-test-a", "exit").length, 1);
	assert.equal(ssh.alive(), 0);
});

test("a dispose while -O check is pending starts no attach, even if the check then succeeds", async (t) => {
	const port = await healthServer(t);
	const checked = Promise.withResolvers<void>();
	// The first check finds no master yet; the second is the one held.
	const { host, ssh } = hostFor(t, { checkAnswered: (call) => (call === 2 ? checked.promise : undefined) }, port);

	host.start();
	await until(() => ssh.of("wb-test-a", "check").length === 2);
	await host.dispose();
	checked.resolve();
	await new Promise((resolve) => setTimeout(resolve, 20));

	assert.deepEqual(
		ssh.calls.map((c) => c.kind),
		["master", "check", "check", "exit"],
	);
});

test("a dispose while the forward's port is chosen starts no forward", async (t) => {
	const port = await healthServer(t);
	const chosen = Promise.withResolvers<number>();
	const { host, ssh } = hostFor(t, {}, () => chosen.promise);

	host.start();
	await until(() => ssh.of("wb-test-a", "exec").length === 1);
	await new Promise((resolve) => setTimeout(resolve, 20));
	await host.dispose();
	chosen.resolve(port);
	await new Promise((resolve) => setTimeout(resolve, 20));

	assert.equal(ssh.of("wb-test-a", "forward").length, 0);
});

test("a dispose while the language forward's port is chosen starts no language forward, probe or endpoint", async (t) => {
	const port = await healthServer(t);
	let probes = 0;
	const vscode: Server = createServer((_request, response) => {
		probes++;
		response.end(COMMIT);
	});
	await new Promise<void>((resolve) => vscode.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => vscode.close(() => resolve(undefined))));
	const chosen = Promise.withResolvers<number>();
	const asked = Promise.withResolvers<void>();
	let calls = 0;
	const languageServer = { port: 45678, connectionToken: "vscode-token", commit: COMMIT };
	const { host, ssh, reports } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "remote-token", { languageServer }) } }, async () => {
		if (++calls === 1) return port;
		asked.resolve();
		return chosen.promise;
	});

	host.start();
	await asked.promise;
	await host.dispose();
	chosen.resolve((vscode.address() as AddressInfo).port);
	await new Promise((resolve) => setTimeout(resolve, 20));

	assert.equal(ssh.of("wb-test-a", "forward").length, 1);
	assert.equal(probes, 0);
	assert.ok(reports.every((report) => !report.endpoint));
});

test("installs off: no probe, stage 1's attach through PATH, and not-installed with the version to install", async (t) => {
	const { flow, prompts, runs } = await installFlow(t, "never");
	const { host, ssh, clock, last } = hostFor(t, { attach: { code: 127 } }, 1, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.deepEqual(last(), {
		alias: "wb-test-a",
		problem: { state: "not-installed", detail: "Whiteboard is not installed on wb-test-a. Install Whiteboard 0.1.6 there; Node 24 is needed." },
	});
	assert.equal(ssh.of("wb-test-a", "probe").length, 0);
	assert.match(ssh.of("wb-test-a", "exec")[0].input!, /command -v whiteboard/);
	assert.deepEqual([prompts.length, runs.length, clock.pending], [0, 0, 0]);
});

test("the version present: no prompt and no install shown; the installed CLI attaches by its path, with --replace", async (t) => {
	const port = await healthServer(t);
	const { flow, prompts, runs } = await installFlow(t, "ask");
	const { host, ssh, reports, last } = hostFor(t, { probe: { installed: [at("0.1.5"), at("0.1.6")] } }, port, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(prompts.length, 0);
	// The installer's own check: the marker's integrity, nothing written when it matches.
	assert.equal(runs.length, 1);
	assert.ok(reports.every((report) => !report.installing));
	assert.equal(ssh.of("wb-test-a", "probe").length, 1);
	assert.equal(
		ssh.of("wb-test-a", "exec")[0].input,
		`exec '${INSTALLED.nodePath}' '${INSTALLED.cliPath}' remote attach --json --replace --groups go\n`,
	);
});

test("an installed host attaches again for its pending extensions by the installed CLI, with --replace and the groups enabled then", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, COMMIT)];
	const { flow } = await installFlow(t, "ask");
	let groups = ["go"];
	const { host, ssh, clock, last } = hostFor(
		t,
		{
			probe: { installed: [at("0.1.6")] },
			attach: (call) => ({ code: 0, stdout: call === 1 ? pendingOutput(41234) : attachOutput(41234, "remote-token", { languageServer: { port: 45678, connectionToken: "vscode-token", commit: COMMIT } }) }),
		},
		ports,
		"wb-test-a",
		"/tmp/wb-ssh-test",
		flow,
		undefined,
		{ groups: async () => groups },
	);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	groups = ["go", "rust"];
	assert.ok(clock.next());
	await until(() => last()?.languageFeatures === true);

	const installed = `exec '${INSTALLED.nodePath}' '${INSTALLED.cliPath}' remote attach --json --replace`;
	assert.deepEqual(
		ssh.of("wb-test-a", "exec").map((call) => call.input),
		[`${installed} --groups go\n`, `${installed} --groups go,rust\n`],
	);
});

test("the version present with another integrity is not installed: the user is asked and the install is shown", async (t) => {
	const port = await healthServer(t);
	const { flow, prompts, runs } = await installFlow(t, "ask", { answers: [true], steps: STEPS });
	// Another pack under 0.1.6; a directory without a complete marker is not listed at all.
	const { host, reports, last } = hostFor(t, { probe: { installed: [at("0.1.5"), at("0.1.6", `sha512-${"B".repeat(86)}==`)] } }, port, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(prompts.length, 1);
	assert.equal(runs.length, 1);
	assert.deepEqual(reports.find((report) => report.installing)?.installing, { step: "preparing" });
	// Calls on the store run in turn: this waits for the move of the answer after the attach.
	assert.equal(await flow.consent.get("wb-test-a"), "allow");
});

test("the version absent with installs always: each step is reported, then the host attaches", async (t) => {
	const port = await healthServer(t);
	const { flow, prompts, runs } = await installFlow(t, "always", { steps: STEPS });
	const { host, reports, last } = hostFor(t, {}, port, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(prompts.length, 0);
	assert.equal(runs.length, 1);
	assert.equal(runs[0].version, "0.1.6");
	assert.equal(runs[0].target, "linux-arm64");
	assert.deepEqual(
		reports.filter((report) => report.installing).map((report) => report.installing),
		[
			{ step: "preparing" },
			{ step: "node", detail: "uploaded from this computer" },
			{ step: "package", detail: "downloaded on the host" },
			{ step: "verifying" },
			{ step: "done" },
		],
	);
	assert.ok(reports.every((report) => !(report.installing && report.endpoint)));
});

test("the version absent, asked and declined: not-installed and declined, and no second prompt on reconnect", async (t) => {
	const { flow, prompts, runs, consentFile } = await installFlow(t, "ask", { answers: [false] });
	const { host, ssh, clock, last } = hostFor(t, { attach: { code: 127 } }, 1, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.equal(prompts.length, 1);
	assert.match(prompts[0].text, /Whiteboard 0\.1\.6 is not installed on wb-test-a/);
	assert.match(prompts[0].text, /Install it in ~\/\.dev\/whiteboard-remote\?/);
	assert.doesNotMatch(prompts[0].text, /\/home\/dev/);
	assert.match(prompts[0].text, /about 60 MB, and about 200 MB for Node 24/);
	assert.deepEqual(last(), {
		alias: "wb-test-a",
		problem: { state: "not-installed", detail: "Whiteboard is not installed on wb-test-a. Install Whiteboard 0.1.6 there; Node 24 is needed." },
		declined: true,
	});
	assert.equal(clock.pending, 0);
	assert.deepEqual(JSON.parse(await readFile(consentFile, "utf8")).aliases, { "wb-test-a": "deny" });

	host.retry();
	await until(() => ssh.of("wb-test-a", "exec").length === 2 && last()?.problem !== undefined);
	assert.equal(prompts.length, 1);
	assert.equal(runs.length, 0);
	assert.equal(last()?.declined, true);
});

test("a declined host with another version's CLI on PATH attaches it, and still offers the install", async (t) => {
	const port = await healthServer(t);
	const { flow, runs } = await installFlow(t, "ask", { answers: [false] });
	const { host, ssh, last } = hostFor(t, {}, port, "wb-test-a", "/tmp/wb-ssh-test", flow, "0.1.7");

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(last()?.declined, true);
	assert.equal(runs.length, 0);
	assert.match(ssh.of("wb-test-a", "exec")[0].input!, /command -v whiteboard/);
	// Calls on the store run in turn: this waits for the move of the answer after the attach.
	assert.equal(await flow.consent.get("wb-test-a"), "deny");
});

test("a prompt nobody answered is not remembered, offers Install, and the next connect asks again", async (t) => {
	const { flow, prompts, consentFile } = await installFlow(t, "ask", { answers: [undefined, undefined] });
	const { host, ssh, last } = hostFor(t, { attach: { code: 127 } }, 1, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.problem !== undefined);
	assert.equal(last()?.problem?.state, "not-installed");
	assert.equal(last()?.declined, true);
	await assert.rejects(readFile(consentFile), { code: "ENOENT" });
	host.retry();
	await until(() => ssh.of("wb-test-a", "exec").length === 2 && last()?.problem !== undefined);

	assert.equal(prompts.length, 2);
});

test("a host the user agreed to is remembered by its server id, so a Desktop update installs without asking", async (t) => {
	const port = await healthServer(t);
	const first = await installFlow(t, "ask", { answers: [true], steps: STEPS });
	const one = hostFor(t, {}, port, "wb-test-a", "/tmp/wb-ssh-test", first.flow);

	one.host.start();
	await until(() => one.last()?.endpoint !== undefined);
	await one.host.dispose();
	// Calls on the store run in turn: this one waits for the write after the attach.
	assert.equal(await first.flow.consent.get("wb-test-a"), "allow");
	assert.equal(first.prompts.length, 1);
	assert.deepEqual(JSON.parse(await readFile(first.consentFile, "utf8")), { servers: { [FAKE_SERVER_ID]: { consent: "allow", alias: "wb-test-a" } }, aliases: {} });

	// The next Desktop version, with the same consent file.
	const second = await installFlow(t, "ask", { steps: STEPS, consentFile: first.consentFile });
	const two = hostFor(t, { probe: { installed: [at("0.1.6")] } }, port, "wb-test-a", "/tmp/wb-ssh-test", second.flow, "0.1.7");

	two.host.start();
	await until(() => two.last()?.endpoint !== undefined);
	assert.equal(second.prompts.length, 0);
	assert.equal(second.runs[0].version, "0.1.7");
	assert.equal(await second.flow.consent.get("wb-test-a"), "allow");
});

test("an unsupported host is reported with the reason, and nothing is installed or attached", async (t) => {
	const { flow, prompts, runs } = await installFlow(t, "always");
	const { host, ssh, clock, last } = hostFor(t, { probe: { glibc: "2.31" } }, 1, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.deepEqual(last()?.problem, { state: "unsupported", detail: "This host runs glibc 2.31; Whiteboard needs 2.34 or newer." });
	assert.deepEqual([prompts.length, runs.length, ssh.of("wb-test-a", "exec").length, clock.pending], [0, 0, 0, 0]);
});

test("a server of another version the CLI started is replaced, and the host comes online", async (t) => {
	const port = await healthServer(t);
	const { flow } = await installFlow(t, "always");
	const { host, last } = hostFor(
		t,
		{ attach: { code: 0, stdout: attachOutput(41234, "new-token", { replaced: true, previousVersion: "0.1.5", startedServer: true }) } },
		port,
		"wb-test-a",
		"/tmp/wb-ssh-test",
		flow,
	);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(last()?.endpoint?.token, "new-token");
});

test("a server of another version a user started is left, and the host is incompatible until a retry", async (t) => {
	const port = await healthServer(t);
	const { flow } = await installFlow(t, "always");
	const { host, ssh, clock, last } = hostFor(
		t,
		{
			attach: (call) => ({
				code: 0,
				stdout: attachOutput(41234, "old-token", call === 1 ? { version: "0.1.5", startedServer: false, incompatibleRunning: { version: "0.1.5", pid: 4242, startedBy: "user" } } : {}),
			}),
		},
		port,
		"wb-test-a",
		"/tmp/wb-ssh-test",
		flow,
	);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.deepEqual(last(), {
		alias: "wb-test-a",
		problem: {
			state: "incompatible",
			detail: "A Whiteboard server 0.1.5 started by a user is running on wb-test-a; stop it to use this Desktop's version.",
		},
	});
	assert.equal(clock.pending, 0);
	assert.equal(ssh.of("wb-test-a", "exec").length, 1);
	// The user stopped that server.
	host.retry();
	await until(() => last()?.endpoint !== undefined);
	assert.equal(ssh.of("wb-test-a", "exec").length, 2);
});

test("a failed install names the step and the reason, is not retried alone, and Retry installs again", async (t) => {
	const port = await healthServer(t);
	const reason = "Installing on wb-test-a failed while installing the package: exit 1: \x1b[31mnpm ERR!\x1b[0m 404\r.";
	const { flow, runs } = await installFlow(t, "always", {
		steps: [{ step: "package", via: "upload" }],
		fails: (call) => (call === 1 ? new Error(reason) : undefined),
	});
	const { host, clock, last } = hostFor(t, {}, port, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.deepEqual(last()?.problem, {
		state: "not-installed",
		detail: "Installing Whiteboard 0.1.6 on wb-test-a failed while installing the package: exit 1: npm ERR! 404 .",
	});
	assert.equal(clock.pending, 0);
	host.retry();
	await until(() => last()?.endpoint !== undefined);
	assert.equal(runs.length, 2);
});

test("an install whose connection dropped is unreachable, and is tried again after the backoff", async (t) => {
	const { flow } = await installFlow(t, "always", {
		steps: [{ step: "node", via: "remote-download" }],
		fails: () => new Error("Installing on wb-test-a failed while unpacking Node: exit 255: Connection to 127.0.0.1 closed by remote host."),
	});
	const { host, clock, last } = hostFor(t, {}, 1, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.deepEqual(last()?.problem, {
		state: "unreachable",
		detail: "The connection to wb-test-a dropped while installing Whiteboard 0.1.6 (installing Node).",
	});
	assert.equal(clock.pending, 1);
});

test("a retry during an install aborts it", async (t) => {
	const port = await healthServer(t);
	const signals: AbortSignal[] = [];
	const { flow } = await installFlow(t, "always");
	const run = flow.run;
	flow.run = async (input) => {
		signals.push(input.signal);
		if (signals.length === 1) await new Promise((resolve) => input.signal.addEventListener("abort", resolve));
		input.signal.throwIfAborted();
		return run(input);
	};
	const { host, last } = hostFor(t, {}, port, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => signals.length === 1);
	host.retry();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(signals[0].aborted, true);
	assert.equal(signals.length, 2);
});

test("a failed upgrade attaches the older version, which reports why, and Retry installs again", async (t) => {
	const port = await healthServer(t);
	const { flow, runs } = await installFlow(t, "always", {
		steps: [{ step: "verifying" }],
		fails: (call) => (call === 1 ? new Error("The package installed on wb-test-a reports version 0.1.5, not 0.1.6.") : undefined),
	});
	const { host, ssh, clock, last } = hostFor(t, { probe: { installed: [at("0.1.5")] } }, port, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last(), {
		alias: "wb-test-a",
		endpoint: { url: `http://127.0.0.1:${port}`, token: "remote-token" },
		...NO_SERVER,
		installFailure: "Installing Whiteboard 0.1.6 on wb-test-a failed while checking the install: The package installed on wb-test-a reports version 0.1.5, not 0.1.6.",
	});
	// The older version, as found on the host: no --replace.
	assert.match(ssh.of("wb-test-a", "exec")[0].input!, /command -v whiteboard/);
	assert.equal(clock.pending, 0);
	host.retry();
	await until(() => last()?.endpoint !== undefined && !last()?.installFailure);
	assert.equal(runs.length, 2);
	assert.match(ssh.of("wb-test-a", "exec")[1].input!, /--replace/);
});

test("a newer server another Desktop started is left, and this Desktop is told to update", async (t) => {
	const { flow } = await installFlow(t, "always");
	const { host, clock, last } = hostFor(
		t,
		{ attach: { code: 0, stdout: attachOutput(41234, "t", { version: "0.1.7", startedServer: false, incompatibleRunning: { version: "0.1.7", pid: 77, startedBy: "desktop" } }) } },
		1,
		"wb-test-a",
		"/tmp/wb-ssh-test",
		flow,
	);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.deepEqual(last()?.problem, {
		state: "incompatible",
		detail: "A newer Whiteboard 0.1.7 is running on wb-test-a, started by another Desktop; update this Desktop to use it.",
	});
	assert.equal(clock.pending, 0);
});

test("a server id that is not a UUID is not used for the install consent", async (t) => {
	const port = await healthServer(t);
	const { flow, consentFile } = await installFlow(t, "ask", { answers: [true] });
	const { host, last } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "t", { serverId: "__proto__" }) } }, port, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(await flow.consent.get("wb-test-a"), "allow");
	assert.deepEqual(JSON.parse(await readFile(consentFile, "utf8")), { servers: {}, aliases: { "wb-test-a": "allow" } });
});

test("a newer server the CLI started says so", async (t) => {
	const { flow } = await installFlow(t, "always");
	const { host, last } = hostFor(
		t,
		{ attach: { code: 0, stdout: attachOutput(41234, "t", { version: "0.1.7", incompatibleRunning: { version: "0.1.7", pid: 77, startedBy: "cli" } }) } },
		1,
		"wb-test-a",
		"/tmp/wb-ssh-test",
		flow,
	);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.equal(last()?.problem?.detail, "A newer Whiteboard 0.1.7 is running on wb-test-a, started by the CLI; update this Desktop to use it.");
});

test("agents are detected once after the first attach, with the installed CLI, and kept", async (t) => {
	const port = await healthServer(t);
	const { flow } = await installFlow(t, "always");
	const attached = new Set<string>();
	const firstAttach = (key: string) => !attached.has(key) && !!attached.add(key);
	const remote: FakeRemote = { detect: { code: 0, stdout: `noise\n${detectOutput([{ id: "pi", name: "Pi", present: true, connected: false }])}` } };
	const { host, ssh, last } = hostFor(t, remote, port, "wb-test-a", "/tmp/wb-ssh-test", flow, "0.1.6", { firstAttach });

	host.start();
	await until(() => ssh.of("wb-test-a", "detect").length === 1);

	assert.ok(last()?.endpoint, "online before agents are read");
	const [detect] = ssh.of("wb-test-a", "detect");
	assert.match(detect.input!, new RegExp(`exec '${INSTALLED.nodePath}' '${INSTALLED.cliPath}' 'connect' '--detect' '--json'\n$`));
	assert.deepEqual(await host.detectAgents(), [{ id: "pi", connected: false }]);
	assert.equal(ssh.of("wb-test-a", "detect").length, 1, "the kept answer");
	assert.equal(ssh.of("wb-test-a", "connect").length, 0, "nothing changed on the host");
	assert.deepEqual([...attached], [FAKE_SERVER_ID]);

	// The same server again, after a reconnect: not detected again on its own.
	host.retry();
	await until(() => ssh.of("wb-test-a", "exec").length === 2);
	await until(() => last()?.endpoint !== undefined);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(ssh.of("wb-test-a", "detect").length, 1);
});

test("a hand-installed host detects with the CLI on its PATH", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, last } = hostFor(t, {}, port, "wb-test-a", "/tmp/wb-ssh-test", undefined, "0.1.6", { firstAttach: () => true });

	host.start();
	await until(() => last()?.endpoint !== undefined && ssh.of("wb-test-a", "detect").length === 1);

	assert.match(ssh.of("wb-test-a", "detect")[0].input!, /exec "\$wb" 'connect' '--detect' '--json'\n$/);
	assert.deepEqual(await host.detectAgents(), []);
});

test("connecting runs the agents' commands with the installed CLI, and refuses agents it did not find or cannot connect alone", async (t) => {
	const port = await healthServer(t);
	const { flow } = await installFlow(t, "always");
	const remote: FakeRemote = {
		detect: {
			code: 0,
			stdout: detectOutput([
				{ id: "pi", present: true, connected: false },
				{ id: "codex", present: true, connected: false, manual: true },
			]),
		},
	};
	const { host, ssh, last } = hostFor(t, remote, port, "wb-test-a", "/tmp/wb-ssh-test", flow);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	for (const ids of [["cursor"], ["codex"], ["claude"], ["__proto__"], ["pi", "x".repeat(10)]]) {
		await assert.rejects(host.connectAgents(ids), /Whiteboard cannot connect .* on wb-test-a/);
	}
	assert.equal(ssh.of("wb-test-a", "connect").length, 0);

	assert.deepEqual(await host.connectAgents(["pi", "pi"]), [{ id: "pi", connected: true, output: "" }]);
	const [connect] = ssh.of("wb-test-a", "connect");
	assert.match(connect.input!, new RegExp(`exec '${INSTALLED.nodePath}' '${INSTALLED.cliPath}' 'connect' '--yes' '--json' 'pi'\n$`));
	assert.deepEqual(await host.detectAgents(), [
		{ id: "codex", connected: false, manual: true },
		{ id: "pi", connected: true },
	]);
});

test("a connect that prints no result fails with ssh's words, as plain text", async (t) => {
	const port = await healthServer(t);
	const remote: FakeRemote = {
		detect: { code: 0, stdout: detectOutput([{ id: "pi", present: true, connected: false }]) },
		connect: { code: 1, stderr: "\u001b[31mboom\u001b[0m\r\nmore\n" },
	};
	const { host, last } = hostFor(t, remote, port, "wb-test-a", "/tmp/wb-ssh-test", undefined, "0.1.6", { firstAttach: () => true });

	host.start();
	await until(() => last()?.endpoint !== undefined);

	await assert.rejects(host.connectAgents(["pi"]), (error: Error) => {
		assert.equal(error.message, "Connecting agents on wb-test-a failed: boom more");
		return true;
	});
});
