/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ReviewGatewayHost } from "../../common/reviewProtocol.js";
import { attachOutput, detectOutput, FAKE_SERVER_ID, fakeClock, fakeSsh, until, type FakeRemote } from "./reviewRemoteFakeSsh.js";
import type { ReviewRemoteInstallFlow } from "./reviewRemoteHost.js";
import { ReviewRemoteHosts } from "./reviewRemoteHosts.js";
import { openRemoteInstallConsent } from "./reviewRemoteInstallConsent.js";
import type { SshPromptRequest } from "./reviewSshAskpass.js";
import { reviewSshInstancePrefix } from "./reviewSshCommand.js";

const COMMIT = "a".repeat(40);

/** The forwarded review server and VS Code server in one: /version answers the commit. */
async function healthServer(t: test.TestContext): Promise<number> {
	const server: Server = createServer((request, response) => response.end(request.url === "/version" ? COMMIT : '{"ok":true}'));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return (server.address() as AddressInfo).port;
}

async function managerFor(
	t: test.TestContext,
	remotes: Record<string, FakeRemote>,
	answer?: string,
	before?: (directory: string) => Promise<void>,
	install?: ReviewRemoteInstallFlow,
) {
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
		install,
	});
	t.after(async () => {
		await manager.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	/** Runs the scheduled sends until `condition` holds for the last one. */
	const sentUntil = async (condition: (hosts: ReviewGatewayHost[]) => boolean) =>
		until(() => {
			clock.next();
			const last = sent.at(-1);
			return last !== undefined && condition(last.hosts);
		});
	return { manager, ssh, clock, sent, sentUntil, port, prompt: () => prompt! };
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
		// rm without recursive refuses a directory: a matching name that is not a socket.
		await mkdir(join(dir, `${prefix}000000000000`));
		await writeFile(join(dir, `${prefix}111111111111`), "");
	});

	manager.update(true, ["wb-test-a"]);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);

	assert.equal(ssh.calls.filter((c) => c.kind === "exit").length, 2);
	assert.deepEqual(await readdir(directory), [`${prefix}000000000000`]);
});

test("a window gets the VS Code server of a machine only while the gateway has it online", async (t) => {
	const attach = { code: 0, stdout: attachOutput(41234, "remote-token", { languageServer: { port: 45678, connectionToken: "vscode-token", commit: COMMIT } }) };
	const { manager, sentUntil, port } = await managerFor(t, { "wb-test-a": { attach } });

	manager.update(true, ["wb-test-a"]);
	await sentUntil((hosts) => byAlias(hosts, "wb-test-a")?.languageFeatures === true);

	const online = [{ alias: "wb-test-a", serverId: FAKE_SERVER_ID, state: "online" as const }];
	assert.deepEqual(await manager.languageEndpoint(FAKE_SERVER_ID, online), { host: "127.0.0.1", port, connectionToken: "vscode-token" });
	assert.equal(await manager.languageEndpoint(FAKE_SERVER_ID, [{ ...online[0], state: "duplicate" }]), undefined);
	assert.equal(await manager.languageEndpoint(FAKE_SERVER_ID, [{ ...online[0], serverId: "s2" }]), undefined);
	assert.equal(await manager.languageEndpoint(FAKE_SERVER_ID, []), undefined);
});

const INSTALLED_INTEGRITY = `sha512-${"A".repeat(86)}==`;
const INSTALLED = { nodePath: "/n/bin/node", cliPath: "/v/cli.js", launcher: "/v/whiteboard", diffr: true };

test("install progress is sent at most once a second, the latest step only", async (t) => {
	const gate = Promise.withResolvers<void>();
	let reported = false;
	const dir = await mkdtemp(join(tmpdir(), "wb-consent-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const flow: ReviewRemoteInstallFlow = {
		mode: () => "always",
		consent: openRemoteInstallConsent(join(dir, "c.json")),
		confirm: async () => true,
		run: async (input) => {
			for (let i = 0; i < 40; i++) input.onProgress(i % 2 ? { step: "package", via: "upload" } : { step: "node", via: "upload" });
			input.onProgress({ step: "verifying" });
			reported = true;
			await gate.promise;
			return INSTALLED;
		},
		integrity: async () => INSTALLED_INTEGRITY,
	};
	const { manager, sent, sentUntil } = await managerFor(t, { "wb-test-a": {} }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => reported);
	await sentUntil((hosts) => hosts[0].installing !== undefined);
	gate.resolve();
	await sentUntil((hosts) => hosts[0].endpoint !== undefined);

	assert.deepEqual(
		sent.filter((send) => send.hosts[0].installing).map((send) => send.hosts[0].installing),
		[{ step: "verifying" }],
	);
	for (let i = 1; i < sent.length; i++) assert.ok(sent[i].at - sent[i - 1].at >= 1000);
});

test("Install on a declined host stores the agreement, installs and attaches", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "wb-consent-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const consentFile = join(dir, "c.json");
	const runs: string[] = [];
	const flow: ReviewRemoteInstallFlow = {
		mode: () => "ask",
		consent: openRemoteInstallConsent(consentFile),
		confirm: async () => false,
		run: async (input) => {
			runs.push(input.version);
			return INSTALLED;
		},
		integrity: async () => INSTALLED_INTEGRITY,
	};
	const { manager, sentUntil } = await managerFor(
		t,
		{ "wb-test-a": { attach: (call) => (call === 1 ? { code: 127 } : { code: 0, stdout: attachOutput(41234) }) } },
		undefined,
		undefined,
		flow,
	);

	manager.update(true, ["wb-test-a"]);
	await sentUntil((hosts) => hosts[0].declined === true);
	await manager.install("wb-test-a");
	await sentUntil((hosts) => hosts[0].endpoint !== undefined);

	assert.deepEqual(runs, ["0.1.6"]);
	assert.equal(await flow.consent.get("wb-test-a"), "allow");
});

test("two hosts asking at once are asked one after the other", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "wb-consent-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	let open = 0;
	const asked: string[] = [];
	const flow: ReviewRemoteInstallFlow = {
		mode: () => "ask",
		consent: openRemoteInstallConsent(join(dir, "c.json")),
		confirm: async ({ alias }) => {
			assert.equal(open++, 0, `${alias} was asked while another prompt was open`);
			asked.push(alias);
			await new Promise((resolve) => setTimeout(resolve, 30));
			open--;
			return true;
		},
		run: async () => INSTALLED,
		integrity: async () => INSTALLED_INTEGRITY,
	};
	// Two servers: an answer moves to the server its host reached, and one server keeps one alias.
	const other = { code: 0, stdout: attachOutput(41234, "remote-token", { serverId: "wb-test-b-server" }) };
	const { manager, sentUntil } = await managerFor(t, { "wb-test-a": {}, "wb-test-b": { attach: other } }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a", "wb-test-b"]);
	await sentUntil((hosts) => hosts.every((host) => host.endpoint));

	assert.deepEqual(asked.sort(), ["wb-test-a", "wb-test-b"]);
	// Calls on the store run in turn: these wait for the moves of the answers after the attaches.
	assert.equal(await flow.consent.get("wb-test-a"), "allow");
	assert.equal(await flow.consent.get("wb-test-b"), "allow");
});

/** A flow whose prompt stays open until the test answers it, or it is cancelled. */
async function promptingFlow(t: test.TestContext) {
	const dir = await mkdtemp(join(tmpdir(), "wb-consent-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const consentFile = join(dir, "c.json");
	const asked: { alias: string; signal?: AbortSignal; answer(value: boolean | undefined): void }[] = [];
	const runs: string[] = [];
	const flow: ReviewRemoteInstallFlow = {
		mode: () => "ask",
		consent: openRemoteInstallConsent(consentFile),
		confirm: (request) =>
			new Promise((resolve) => {
				asked.push({ alias: request.alias, signal: request.signal, answer: resolve });
				request.signal?.addEventListener("abort", () => resolve(undefined));
			}),
		run: async (input) => {
			runs.push(input.version);
			return INSTALLED;
		},
		integrity: async () => INSTALLED_INTEGRITY,
	};
	return { flow, asked, runs, consentFile };
}

test("a retry while the install prompt is open joins it: one prompt, one answer applied", async (t) => {
	const { flow, asked, runs } = await promptingFlow(t);
	const { manager, sentUntil } = await managerFor(t, { "wb-test-a": {} }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	manager.retry("wb-test-a");
	// The new connection reaches the question again, and waits on the same one.
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(asked.length, 1);
	assert.equal(asked[0].signal?.aborted, false);
	asked[0].answer(true);
	await sentUntil((hosts) => hosts[0].endpoint !== undefined);

	assert.equal(asked.length, 1);
	assert.deepEqual(runs, ["0.1.6"]);
	assert.equal(await flow.consent.get("wb-test-a"), "allow");
});

test("removing a host while its prompt is open closes the prompt and writes nothing", async (t) => {
	const { flow, asked, consentFile } = await promptingFlow(t);
	const { manager } = await managerFor(t, { "wb-test-a": {} }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	manager.update(true, []);

	await until(() => asked[0].signal?.aborted === true);
	await new Promise((resolve) => setTimeout(resolve, 50));
	await assert.rejects(readFile(consentFile), { code: "ENOENT" });
});

test("a dropped connection closes the host's prompt, and the next connection asks again", async (t) => {
	const { flow, asked, consentFile } = await promptingFlow(t);
	const { manager, ssh, clock } = await managerFor(t, { "wb-test-a": {} }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	ssh.master("wb-test-a")!.finish(255, { stderr: "Connection reset by peer\n" });
	await until(() => asked[0].signal?.aborted === true);
	await assert.rejects(readFile(consentFile), { code: "ENOENT" });

	// The backoff's reconnect asks a fresh question.
	await until(() => {
		clock.next();
		return asked.length === 2;
	});
	assert.equal(asked[1].signal?.aborted, false);
});

test("quitting while a prompt is open closes it without an unhandled rejection", async (t) => {
	const rejections: unknown[] = [];
	const record = (reason: unknown) => rejections.push(reason);
	process.on("unhandledRejection", record);
	t.after(() => void process.off("unhandledRejection", record));
	const { flow, asked } = await promptingFlow(t);
	const { manager } = await managerFor(t, { "wb-test-a": {} }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	await manager.dispose();
	await new Promise((resolve) => setTimeout(resolve, 50));

	assert.equal(asked[0].signal?.aborted, true);
	assert.deepEqual(rejections, []);
});

test("a question cancelled while still queued is not joined: the next connection is asked", async (t) => {
	const { flow, asked } = await promptingFlow(t);
	const { manager, ssh, clock } = await managerFor(t, { "wb-test-a": {}, "wb-test-b": {} }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a", "wb-test-b"]);
	await until(() => asked.length === 1);
	const other = asked[0].alias === "wb-test-a" ? "wb-test-b" : "wb-test-a";
	// The other host's question waits behind the open one; its connection drops.
	await until(() => ssh.of(other, "probe").length === 1);
	await new Promise((resolve) => setTimeout(resolve, 20));
	ssh.master(other)!.finish(255, { stderr: "Connection reset by peer\n" });
	await until(() => {
		clock.next();
		return ssh.of(other, "probe").length === 2;
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	asked[0].answer(undefined);

	await until(() => asked.length === 2);
	assert.equal(asked[1].alias, other);
	assert.equal(asked[1].signal?.aborted, false);
	asked[1].answer(undefined);
});

test("removing Whiteboard runs while nothing reconnects, then forgets the answer and closes the host; adding it again asks", async (t) => {
	const { flow, asked, runs } = await promptingFlow(t);
	let finish!: () => void;
	const after = new Promise<void>((resolve) => (finish = resolve));
	t.after(() => finish());
	const { manager, ssh, clock, sentUntil } = await managerFor(t, { "wb-test-a": { uninstall: { ok: true, after } } }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	asked[0].answer(true);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);
	assert.equal(await flow.consent.get("wb-test-a"), "allow");

	const before = ssh.calls.length;
	const removed = manager.uninstall("wb-test-a");
	// A second request, as from another Settings window, joins the first.
	assert.equal(manager.uninstall("wb-test-a"), removed);
	await until(() => ssh.of("wb-test-a", "uninstall").length === 2);
	// The stopped server fails the gateway's health check, which asks for a reattach; a wake asks for a check.
	manager.reattach("wb-test-a");
	manager.resume();
	manager.retry("wb-test-a");
	while (clock.next());
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(ssh.calls.slice(before).map((call) => call.kind), ["uninstall", "uninstall"]);
	assert.ok(ssh.master("wb-test-a")!.alive);
	finish();
	await removed;

	assert.equal(await flow.consent.get("wb-test-a"), undefined);
	await until(() => !ssh.master("wb-test-a")!.alive);
	await sentUntil((hosts) => hosts.length === 0);
	// Still in the setting until Settings saves: it stays closed.
	manager.update(true, ["wb-test-a"]);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(ssh.of("wb-test-a", "master").length, 1);

	manager.update(true, []);
	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 2);
	assert.deepEqual(runs, ["0.1.6"]);
});

test("a host removed without removing Whiteboard keeps the answer; a failed uninstall keeps it, and the host waits for the setting", async (t) => {
	const { flow, asked } = await promptingFlow(t);
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": { uninstall: { ok: false } } }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	asked[0].answer(true);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);

	await assert.rejects(manager.uninstall("wb-test-a"), /Could not remove Whiteboard from wb-test-a: refused/);
	assert.equal(await flow.consent.get("wb-test-a"), "allow");
	// Settings removes the alias next; nothing reconnects before it does.
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(ssh.of("wb-test-a", "master").length, 1);
	// An alias the setting keeps connects afresh.
	manager.update(true, ["wb-test-a"]);
	await until(() => ssh.of("wb-test-a", "master").length === 2);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);

	manager.update(true, []);
	await until(() => !ssh.master("wb-test-a")!.alive);
	assert.equal(await flow.consent.get("wb-test-a"), "allow");
	assert.equal(asked.length, 1);
});

test("a setting change that keeps the alias during an uninstall changes nothing until the uninstall ends", async (t) => {
	const { flow, asked } = await promptingFlow(t);
	let finish!: () => void;
	const after = new Promise<void>((resolve) => (finish = resolve));
	t.after(() => finish());
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": { uninstall: { ok: false, after } } }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	asked[0].answer(true);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);
	const removed = manager.uninstall("wb-test-a");
	await until(() => ssh.of("wb-test-a", "uninstall").length === 2);
	manager.update(true, ["wb-test-a"]);
	await new Promise((resolve) => setTimeout(resolve, 20));

	assert.equal(ssh.of("wb-test-a", "master").length, 1);
	assert.equal(ssh.of("wb-test-a", "exit").length, 0);
	assert.ok(ssh.master("wb-test-a")!.alive);
	finish();
	await assert.rejects(removed, /refused/);
	assert.equal(ssh.of("wb-test-a", "master").length, 1);
	// The next change decides: the alias stays, so the host connects afresh.
	manager.update(true, ["wb-test-a"]);
	await until(() => ssh.of("wb-test-a", "master").length === 2);
});

test("an alias removed during a successful uninstall is closed once", async (t) => {
	const { flow, asked } = await promptingFlow(t);
	let finish!: () => void;
	const after = new Promise<void>((resolve) => (finish = resolve));
	t.after(() => finish());
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": { uninstall: { ok: true, after }, exitDelayMs: 50 } }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	asked[0].answer(true);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);
	const removed = manager.uninstall("wb-test-a");
	await until(() => ssh.of("wb-test-a", "uninstall").length === 2);
	manager.update(true, []);
	finish();
	await removed;

	assert.equal(ssh.master("wb-test-a")!.alive, false);
	assert.equal(ssh.of("wb-test-a", "exit").length, 1);
	await manager.dispose();
});

test("quitting while a removed host's master closes waits for it", async (t) => {
	const { flow, asked } = await promptingFlow(t);
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": { uninstall: { ok: true }, exitDelayMs: 150 } }, undefined, undefined, flow);

	manager.update(true, ["wb-test-a"]);
	await until(() => asked.length === 1);
	asked[0].answer(true);
	await sentUntil((hosts) => hosts[0]?.endpoint !== undefined);
	const removed = manager.uninstall("wb-test-a");
	await until(() => ssh.of("wb-test-a", "exit").length === 1);
	await manager.dispose();

	assert.equal(ssh.master("wb-test-a")!.alive, false);
	await removed;
});

test("a server's agents are read on their own once a session, and again only when asked", async (t) => {
	const { manager, ssh, sentUntil } = await managerFor(t, { "wb-test-a": { detect: { code: 0, stdout: detectOutput([{ id: "pi", present: true, connected: false }]) } } });

	manager.update(true, ["wb-test-a"]);
	await sentUntil((hosts) => byAlias(hosts, "wb-test-a")?.endpoint !== undefined);
	await until(() => ssh.of("wb-test-a", "detect").length === 1);

	// Removed and added again: the same server is not read again on its own.
	manager.update(true, []);
	manager.update(true, ["wb-test-a"]);
	await sentUntil((hosts) => byAlias(hosts, "wb-test-a")?.endpoint !== undefined);
	await until(() => ssh.of("wb-test-a", "exec").length === 2);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(ssh.of("wb-test-a", "detect").length, 1);

	assert.deepEqual(await manager.detectAgents("wb-test-a"), [{ id: "pi", connected: false }]);
	assert.equal(ssh.of("wb-test-a", "detect").length, 2);
	assert.equal(await manager.detectAgents("wb-test-b"), undefined);
	assert.deepEqual(await manager.connectAgents("wb-test-a", ["pi"]), [{ id: "pi", connected: true, output: "" }]);
	await assert.rejects(manager.connectAgents("wb-test-b", ["pi"]), /wb-test-b is not a remote host/);
});
