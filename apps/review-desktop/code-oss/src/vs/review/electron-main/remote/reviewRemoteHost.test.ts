/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { ReviewGatewayHost } from "../../common/reviewProtocol.js";
import { attachOutput, fakeClock, fakeSsh, until, type FakeRemote } from "./reviewRemoteFakeSsh.js";
import { classifySshFailure, reconnectDelay, ReviewRemoteHost } from "./reviewRemoteHost.js";
import { reviewSshSession } from "./reviewSshCommand.js";

/** Stands in for the forwarded port: the probe reaches it through real HTTP. */
async function healthServer(t: test.TestContext): Promise<number> {
	const server: Server = createServer((_request, response) => response.end('{"ok":true}'));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return (server.address() as AddressInfo).port;
}

function hostFor(t: test.TestContext, remote: FakeRemote, port: number, alias = "wb-test-a") {
	const clock = fakeClock();
	const ssh = fakeSsh({ [alias]: remote }, clock);
	const reports: ReviewGatewayHost[] = [];
	const host = new ReviewRemoteHost({
		session: reviewSshSession(alias, "/tmp/wb-ssh-test"),
		spawn: ssh.spawn,
		environment: async () => ({ PATH: "/usr/bin" }),
		desktopVersion: async () => "0.1.6",
		freePort: async () => port,
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

	assert.deepEqual(last(), { alias: "wb-test-a", endpoint: { url: `http://127.0.0.1:${port}`, token: "remote-token" } });
	const [forward] = ssh.of("wb-test-a", "forward");
	assert.ok(forward.args.includes(`127.0.0.1:${port}:127.0.0.1:41234`));
	// The master answered -O check before the script ran through it.
	const kinds = ssh.calls.map((c) => c.kind);
	assert.ok(kinds.indexOf("check") < kinds.indexOf("exec"));
});

test("output with a banner before the first sentinel still parses", async (t) => {
	const port = await healthServer(t);
	const banner = "Welcome to Ubuntu 22.04\n\nLast login: yesterday\nnvm: using node 24";
	const { host, last } = hostFor(t, { attach: { code: 0, stdout: `${banner}${attachOutput(41234, "t2")}bye\n` } }, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);

	assert.equal(last()?.endpoint?.token, "t2");
});

test("exit 127 from the script is not-installed, with the install command", async (t) => {
	const { host, clock, last } = hostFor(t, { attach: { code: 127 } }, 1);

	host.start();
	await until(() => last()?.problem !== undefined);

	assert.equal(last()?.problem?.state, "not-installed");
	assert.match(last()!.problem!.detail, /npm install -g @dev\.fast\/whiteboard@0\.1\.6/);
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

test("a resume replaces a master that no longer answers", async (t) => {
	const port = await healthServer(t);
	const { host, ssh, clock, last } = hostFor(t, {}, port);

	host.start();
	await until(() => last()?.endpoint !== undefined);
	const first = ssh.master("wb-test-a")!;
	ssh.wedge("wb-test-a");
	await host.resume();
	await until(() => ssh.of("wb-test-a", "master").length === 2 && ssh.master("wb-test-a") !== first);
	await until(() => !first.alive);
	assert.equal(clock.pending, 0);
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
