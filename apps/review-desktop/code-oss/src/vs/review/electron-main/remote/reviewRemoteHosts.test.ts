/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ReviewGatewayHost } from "../../common/reviewProtocol.js";
import { fakeClock, fakeSsh, until, type FakeRemote } from "./reviewRemoteFakeSsh.js";
import { ReviewRemoteHosts } from "./reviewRemoteHosts.js";
import type { SshPromptRequest } from "./reviewSshAskpass.js";
import { reviewSshInstancePrefix } from "./reviewSshCommand.js";

async function healthServer(t: test.TestContext): Promise<number> {
	const server: Server = createServer((_request, response) => response.end('{"ok":true}'));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return (server.address() as AddressInfo).port;
}

async function managerFor(t: test.TestContext, remotes: Record<string, FakeRemote>, answer?: string, before?: (directory: string) => Promise<void>) {
	const port = await healthServer(t);
	const directory = await mkdtemp(join(tmpdir(), "wb-hosts-"));
	await before?.(directory);
	const clock = fakeClock();
	const ssh = fakeSsh(remotes, clock);
	const sent: { at: number; hosts: ReviewGatewayHost[] }[] = [];
	let prompt: ((request: SshPromptRequest) => Promise<string | undefined>) | undefined;
	const manager = new ReviewRemoteHosts({
		spawn: ssh.spawn,
		controlDirectory: directory,
		instance: "/user-data",
		environment: async () => ({ PATH: "/usr/bin" }),
		createAskpass: async (input) => {
			prompt = input.prompt;
			return { env: (alias) => ({ SSH_ASKPASS: "askpass", ALIAS: alias }), dispose() {} };
		},
		prompt: async () => answer,
		desktopVersion: async () => "0.1.6",
		freePort: async () => port,
		send: (hosts) => sent.push({ at: clock.now(), hosts }),
		log: () => {},
		clock,
		timeouts: { poll: 1 },
	});
	t.after(async () => {
		await manager.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	const sentUntil = async (condition: (hosts: ReviewGatewayHost[]) => boolean) =>
		until(() => {
			clock.next();
			const last = sent.at(-1);
			return last !== undefined && condition(last.hosts);
		});
	return { manager, ssh, clock, sent, sentUntil, prompt: () => prompt! };
}

const byAlias = (hosts: ReviewGatewayHost[], alias: string) => hosts.find((h) => h.alias === alias);

test("a host whose ssh never returns does not hold another, and update returns at once", async (t) => {
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-slow": { master: "hang" }, "wb-test-fast": {} });

	manager.update(true, ["wb-test-slow", "wb-test-fast"]);
	assert.equal(ssh.calls.length, 0);

	await sentUntil((hosts) => byAlias(hosts, "wb-test-fast")?.endpoint !== undefined);
	const slow = ssh.of("wb-test-slow", "master");
	assert.equal(slow.length, 1);
	assert.ok(ssh.master("wb-test-slow")?.alive);
});

test("hosts are sent in the setting's order, at most once a second", async (t) => {
	const { manager, sent, sentUntil } = await managerFor(t, { "wb-test-a": {}, "wb-test-b": {} });

	manager.update(true, ["wb-test-b", "wb-test-a"]);
	await sentUntil((hosts) => hosts.every((h) => h.endpoint));

	assert.deepEqual(sent.at(-1)!.hosts.map((h) => h.alias), ["wb-test-b", "wb-test-a"]);
	for (let i = 1; i < sent.length; i++) assert.ok(sent[i].at - sent[i - 1].at >= 1000);
});

test("removing a host from the setting closes its connection", async (t) => {
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": {}, "wb-test-b": {} });

	manager.update(true, ["wb-test-a", "wb-test-b"]);
	await sentUntil((hosts) => hosts.every((h) => h.endpoint));
	manager.update(true, ["wb-test-b"]);
	await sentUntil((hosts) => hosts.length === 1);

	await until(() => !ssh.master("wb-test-a")!.alive);
	assert.equal(ssh.of("wb-test-a", "exit").length, 1);
	assert.ok(ssh.master("wb-test-b")!.alive);
});

test("an alias added again while its old host closes starts only after the old master exited", async (t) => {
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": { exitDelayMs: 150 } });

	manager.update(true, ["wb-test-a"]);
	await sentUntil((hosts) => byAlias(hosts, "wb-test-a")?.endpoint !== undefined);
	const first = ssh.master("wb-test-a")!;
	manager.update(true, []);
	manager.update(true, ["wb-test-a"]);
	await until(() => ssh.of("wb-test-a", "master").length === 2);

	assert.ok(first.exitedAt !== undefined && ssh.of("wb-test-a", "master")[1].wall >= first.exitedAt);
});

test("removing a host whose master is still connecting ends that ssh at once", async (t) => {
	const { manager, ssh } = await managerFor(t, { "wb-test-slow": { master: "hang" } });

	manager.update(true, ["wb-test-slow"]);
	await until(() => ssh.master("wb-test-slow") !== undefined);
	manager.update(true, []);

	await until(() => !ssh.master("wb-test-slow")!.alive, 500);
	assert.equal(ssh.master("wb-test-slow")!.signalCode, "SIGTERM");
});

test("with the experimental setting off, nothing connects and no hosts are sent", async (t) => {
	const { manager, ssh, sent, clock } = await managerFor(t, { "wb-test-a": {} });

	manager.update(false, ["wb-test-a"]);
	await new Promise((resolve) => setTimeout(resolve, 20));
	while (clock.next());

	assert.equal(ssh.calls.length, 0);
	assert.equal(sent.length, 0);
});

test("an invalid alias is unreachable with the reason and never reaches ssh", async (t) => {
	const { manager, ssh, sentUntil } = await managerFor(t, {});

	manager.update(true, ["-oProxyCommand=x"]);
	await sentUntil((hosts) => hosts[0]?.problem !== undefined);

	assert.equal(ssh.calls.length, 0);
});

test("a prompt cancelled through askpass is auth-failed, until a retry", async (t) => {
	const { manager, ssh, sent, sentUntil, prompt } = await managerFor(t, { "wb-test-c": { master: "hang" } }, undefined);

	manager.update(true, ["wb-test-c"]);
	await until(() => ssh.master("wb-test-c") !== undefined);
	assert.equal(await prompt()({ alias: "wb-test-c", text: "dev@h's password: ", kind: "secret" }), undefined);
	ssh.master("wb-test-c")!.finish(255, { stderr: "dev@h: Permission denied (publickey,password).\n" });
	await sentUntil((hosts) => hosts[0]?.problem?.state === "auth-failed");
	const count = sent.length;

	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(ssh.of("wb-test-c", "master").length, 1);
	assert.equal(sent.length, count);

	manager.retry("wb-test-c");
	await until(() => ssh.of("wb-test-c", "master").length === 2);
});

test("at start, sockets an earlier run of this Desktop left are closed and removed; others are kept", async (t) => {
	const mine = `${reviewSshInstancePrefix("/user-data")}0123456789ab`;
	const theirs = `${reviewSshInstancePrefix("/other-user-data")}0123456789ab`;
	let directory = "";
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": {} }, undefined, async (dir) => {
		directory = dir;
		await writeFile(join(dir, mine), "");
		await writeFile(join(dir, theirs), "");
	});

	manager.update(true, ["wb-test-a"]);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);

	const exits = ssh.calls.filter((c) => c.kind === "exit");
	assert.equal(exits.length, 1);
	assert.equal(exits[0].args[exits[0].args.indexOf("-S") + 1], join(directory, mine));
	assert.ok(ssh.calls.indexOf(exits[0]) < ssh.calls.findIndex((c) => c.kind === "master"));
	assert.deepEqual(await readdir(directory), [theirs]);
});

test("an entry the sweep cannot remove does not stop the sweep or the hosts", async (t) => {
	const prefix = reviewSshInstancePrefix("/user-data");
	let directory = "";
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": {} }, undefined, async (dir) => {
		directory = dir;
		await mkdir(join(dir, `${prefix}000000000000`));
		await writeFile(join(dir, `${prefix}111111111111`), "");
	});

	manager.update(true, ["wb-test-a"]);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);

	assert.equal(ssh.calls.filter((c) => c.kind === "exit").length, 2);
	assert.deepEqual(await readdir(directory), [`${prefix}000000000000`]);
});
