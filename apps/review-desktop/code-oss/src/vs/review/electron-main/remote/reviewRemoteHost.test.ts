/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ReviewGatewayHost } from "../../common/reviewProtocol.js";
import { attachOutput, fakeClock, fakeSsh, until, type FakeRemote } from "./reviewRemoteFakeSsh.js";
import { classifySshFailure, languageCommitMismatch, reconnectDelay, ReviewRemoteHost } from "./reviewRemoteHost.js";
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

const NO_SERVER = { languageFeatures: false, languageFeaturesDetail: "Language features are unavailable on wb-test-a: The Whiteboard on this host has no VS Code server." };

/** `ports` are handed out in turn as the free local ports. */
function hostFor(
	t: test.TestContext,
	remote: FakeRemote,
	ports: number | number[] | (() => Promise<number>),
	alias = "wb-test-a",
	controlDirectory = "/tmp/wb-ssh-test",
	desktopCommit?: string,
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
		desktopVersion: async () => "0.1.6",
		desktopCommit,
		groups: async () => ["go"],
		freePort: typeof ports === "function" ? ports : async () => free[next++ % free.length],
		report: (state) => reports.push(state),
		log: () => {},
		clock,
		timeouts: { poll: 1 },
	});
	t.after(() => host.dispose());
	return { host, ssh, clock, reports, last: () => reports.at(-1) };
}

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
	const { host, ssh, last } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "remote-token", languageServer) } }, ports);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last(), { alias: "wb-test-a", endpoint: { url: `http://127.0.0.1:${ports[0]}`, token: "remote-token" }, languageFeatures: true });
	assert.equal(ssh.of("wb-test-a", "master").length, 1);
	const forwards = ssh.of("wb-test-a", "forward").map((call) => call.args.find((arg) => arg.startsWith("127.0.0.1:")));
	assert.deepEqual(forwards, [`127.0.0.1:${ports[0]}:127.0.0.1:41234`, `127.0.0.1:${ports[1]}:127.0.0.1:45678`]);
	assert.deepEqual(await host.languageEndpoint("s1"), { host: "127.0.0.1", port: ports[1], connectionToken: "vscode-token" });
	assert.equal(await host.languageEndpoint("another machine"), undefined);
	assert.doesNotMatch(JSON.stringify(last()), /vscode-token/);
});

test("the Desktop's enabled groups go to remote attach", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, last } = hostFor(t, {}, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.match(ssh.of("wb-test-a", "exec")[0].input(), /exec "\$wb" remote attach --json --groups go\n$/);
});

test("a VS Code server of another commit leaves the review online without language features", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, COMMIT)];
	const languageServer = { port: 45678, connectionToken: "vscode-token", commit: COMMIT };
	const { host, ssh, last } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "remote-token", languageServer) } }, ports, "wb-test-a", "/tmp/wb-ssh-test", "b".repeat(40));

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last(), {
		alias: "wb-test-a",
		endpoint: { url: `http://127.0.0.1:${ports[0]}`, token: "remote-token" },
		languageFeatures: false,
		languageFeaturesDetail: "language features need the same Whiteboard version on wb-test-a: it runs aaaaaaa, this Desktop bbbbbbb",
	});
	assert.equal(ssh.of("wb-test-a", "forward").length, 1);
	assert.equal(await host.languageEndpoint("s1"), undefined);
});

test("a dev Desktop, with no commit, accepts any VS Code server; a release Desktop only its own", () => {
	assert.equal(languageCommitMismatch("a", COMMIT, undefined), undefined);
	assert.equal(languageCommitMismatch("a", COMMIT, COMMIT), undefined);
	assert.match(languageCommitMismatch("a", COMMIT, "b".repeat(40))!, /on a: it runs aaaaaaa, this Desktop bbbbbbb$/);
});

test("a VS Code server that does not answer through its forward is unavailable, and its forward is cancelled", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, "c".repeat(40))];
	const languageServer = { port: 45678, connectionToken: "vscode-token", commit: COMMIT };
	const { host, ssh, last } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "remote-token", languageServer) } }, ports);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(last()?.languageFeatures, false);
	assert.match(last()!.languageFeaturesDetail!, /did not answer through the forward: it reports c{40}, not a{40}\.$/);
	const cancels = ssh.of("wb-test-a", "cancel");
	assert.equal(cancels.length, 1);
	assert.ok(cancels[0].args.includes(`127.0.0.1:${ports[1]}:127.0.0.1:45678`));
	assert.equal(await host.languageEndpoint("s1"), undefined);
});

test("a reattach drops both old forwards", async (t) => {
	const ports = [await healthServer(t), await versionServer(t, COMMIT), await healthServer(t), await versionServer(t, COMMIT)];
	const { host, ssh, last } = hostFor(
		t,
		{ attach: (call) => ({ code: 0, stdout: attachOutput(41234 + call, `token-${call}`, { port: 45678 + call, connectionToken: `vscode-${call}`, commit: COMMIT }) }) },
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
	assert.deepEqual(await host.languageEndpoint("s1"), { host: "127.0.0.1", port: ports[3], connectionToken: "vscode-2" });
});

const PENDING_DETAIL = "Installing the language extensions on this host; they will be available on the next connection.";

/** An attach whose remote is still installing its language extensions. */
const pendingOutput = (port: number) =>
	`WHITEBOARD-REMOTE-BEGIN\n${JSON.stringify({ event: "remote.attach", version: "0.1.6", commit: "abc", serverId: "s1", url: `http://127.0.0.1:${port}`, token: "remote-token", startedServer: false, diffr: true, languageServer: null, languageServerDetail: PENDING_DETAIL, languageServerPending: true })}\nWHITEBOARD-REMOTE-END\n`;

test("a VS Code server that stopped answering is not handed out, and the host attaches again", async (t) => {
	const stopped: Server = createServer((request, response) => response.end(request.url === "/version" ? COMMIT : ""));
	await new Promise<void>((resolve) => stopped.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => stopped.close(() => resolve(undefined))));
	const ports = [await healthServer(t), (stopped.address() as AddressInfo).port, await versionServer(t, COMMIT)];
	const { host, ssh, last } = hostFor(
		t,
		{ attach: (call) => ({ code: 0, stdout: attachOutput(41234, "remote-token", { port: 45677 + call, connectionToken: `vscode-${call}`, commit: COMMIT }) }) },
		ports,
	);

	host.start();
	await until(() => last()?.languageFeatures === true);
	await new Promise((resolve) => stopped.close(resolve));

	assert.equal(await host.languageEndpoint("s1"), undefined);
	await until(() => ssh.of("wb-test-a", "exec").length === 2 && ssh.of("wb-test-a", "cancel").length === 1);
	assert.deepEqual(await host.languageEndpoint("s1"), { host: "127.0.0.1", port: ports[2], connectionToken: "vscode-2" });
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
		{ attach: (call) => ({ code: 0, stdout: call === 1 ? pendingOutput(41234) : attachOutput(41234, "remote-token", { port: 45678, connectionToken: `vscode-${call}`, commit: COMMIT }) }) },
		ports,
	);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	assert.ok(clock.next());
	// The pending attach is running; the gateway's request must not be lost.
	await host.reattach();
	await until(() => ssh.of("wb-test-a", "exec").length === 3 && last()?.endpoint?.url === `http://127.0.0.1:${ports[2]}`);

	assert.equal(last()?.languageFeatures, true);
	assert.deepEqual(await host.languageEndpoint("s1"), { host: "127.0.0.1", port: ports[3], connectionToken: "vscode-3" });
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
		{ attach: (call) => ({ code: 0, stdout: call === 1 ? pendingOutput(41234) : attachOutput(41234, "remote-token", { port: 45678, connectionToken: "vscode-token", commit: COMMIT }) }) },
		ports,
	);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.deepEqual(last(), {
		alias: "wb-test-a",
		endpoint: { url: `http://127.0.0.1:${ports[0]}`, token: "remote-token" },
		languageFeatures: false,
		languageFeaturesDetail: `Language features are unavailable on wb-test-a: ${PENDING_DETAIL}`,
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
	assert.equal(last()?.languageFeaturesDetail, `Language features are unavailable on wb-test-a: ${PENDING_DETAIL}`);
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
	const { host, ssh, reports } = hostFor(t, { attach: { code: 0, stdout: attachOutput(41234, "remote-token", languageServer) } }, async () => {
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
