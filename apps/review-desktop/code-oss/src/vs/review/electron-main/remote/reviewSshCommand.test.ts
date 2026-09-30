/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	prepareSshControlDirectory,
	reviewSshConfigPath,
	reviewSshControlDirectory,
	reviewSshSession,
	sshCancelForwardArgs,
	sshCloseArgs,
	sshExecArgs,
	sshForwardArgs,
	sshMasterArgs,
	validateSshAlias,
} from "./reviewSshCommand.js";

const session = { alias: "wb-test-a", controlPath: "/tmp/wb-ssh-501/0123456789ab" };

const allArgs = (env: NodeJS.ProcessEnv = {}) => [
	sshMasterArgs(session, env),
	sshExecArgs(session, env),
	sshForwardArgs(session, 41000, 42000, env),
	sshCancelForwardArgs(session, 41000, 42000, env),
	sshCloseArgs(session, env),
];

test("refuses aliases that could become options or reach a shell", () => {
	for (const alias of ["-oProxyCommand=x", "a b", "a`id`", "", "a\u0001b", "a$HOME", "a;b", "a|b", "a&b", "a<b", "a>b", "a(b", "a)b", "a'b", 'a"b', "a\\b"])
		assert.equal(validateSshAlias(alias).ok, false, JSON.stringify(alias));
});

test("accepts ordinary aliases", () => {
	for (const alias of ["wb-test-a", "dev@build.example.com", "box_2", "10.0.0.7", "a-"])
		assert.deepEqual(validateSshAlias(alias), { ok: true }, alias);
});

test("a session and every builder refuse an invalid alias", () => {
	assert.throws(() => reviewSshSession("-oProxyCommand=x", "/tmp/d"), /starts with -/);
	const handBuilt = { alias: "-oProxyCommand=x", controlPath: "/tmp/d/x" };
	assert.throws(() => sshMasterArgs(handBuilt, {}), /starts with -/);
	assert.throws(() => sshForwardArgs(handBuilt, 1, 2, {}), /starts with -/);
});

test("the forward refuses a port outside 1-65535", () => {
	assert.throws(() => sshForwardArgs(session, 0, 42000, {}), /Invalid port 0/);
	assert.throws(() => sshCancelForwardArgs(session, 41000, 1.5, {}), /Invalid port 1.5/);
});

test("every argument list ends with -- and the alias, and exec with the fixed command after it", () => {
	const [master, exec, ...others] = allArgs();
	assert.deepEqual(master.slice(-2), ["--", "wb-test-a"]);
	assert.deepEqual(exec.slice(-4), ["--", "wb-test-a", "sh", "-s"]);
	for (const args of others) assert.deepEqual(args.slice(-2), ["--", "wb-test-a"]);
	for (const args of allArgs()) assert.equal(args.indexOf("--"), args.lastIndexOf("--"));
});

test("no argument list overrides host-key checking or prompting", () => {
	for (const args of allArgs({ DEV_FAST_REVIEW_SSH_CONFIG: "/tmp/c", VSCODE_DEV: "1" }))
		for (const arg of args) assert.doesNotMatch(arg, /StrictHostKeyChecking|UserKnownHostsFile|BatchMode/i);
});

test("every call after the master reuses its control socket", () => {
	const [, exec, forward, cancel, close] = allArgs();
	for (const args of [exec, forward, cancel, close]) assert.equal(args[args.indexOf("-S") + 1], session.controlPath);
	assert.ok(exec.includes("-oControlMaster=no"));
	assert.equal(forward[forward.indexOf("-O") + 1], "forward");
	assert.equal(cancel[cancel.indexOf("-O") + 1], "cancel");
});

test("the forward and its cancel bind loopback on both ends", () => {
	for (const args of [sshForwardArgs(session, 41000, 42000, {}), sshCancelForwardArgs(session, 41000, 42000, {})])
		assert.equal(args[args.indexOf("-L") + 1], "127.0.0.1:41000:127.0.0.1:42000");
});

test("a development config file is passed to every call, and ignored in a packaged build", () => {
	for (const args of allArgs({ DEV_FAST_REVIEW_SSH_CONFIG: "/tmp/c", VSCODE_DEV: "1" }))
		assert.deepEqual(args.slice(0, 2), ["-F", "/tmp/c"]);
	for (const args of allArgs({ DEV_FAST_REVIEW_SSH_CONFIG: "/tmp/c" }))
		assert.equal(args.includes("-F"), false);
	assert.equal(reviewSshConfigPath({ DEV_FAST_REVIEW_SSH_CONFIG: "/tmp/c", VSCODE_DEV: "1" }, "/home/u"), "/tmp/c");
	assert.equal(reviewSshConfigPath({ DEV_FAST_REVIEW_SSH_CONFIG: "/tmp/c" }, "/home/u"), "/home/u/.ssh/config");
});

test("the control path is under 100 bytes for a 40-character alias", () => {
	const alias = "a".repeat(40);
	const { controlPath } = reviewSshSession(alias);
	assert.ok(Buffer.byteLength(controlPath) < 100, controlPath);
	assert.ok(controlPath.startsWith(reviewSshControlDirectory()));
	assert.notEqual(reviewSshSession("b".repeat(40)).controlPath, controlPath);
});

test("the control directory is created 0700, repaired, and a symlink is refused", async (t) => {
	const parent = await mkdtemp(join(tmpdir(), "wb-ssh-test-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const dir = join(parent, "control");

	await prepareSshControlDirectory(dir);
	assert.equal((await lstat(dir)).mode & 0o777, 0o700);

	await chmod(dir, 0o755);
	await prepareSshControlDirectory(dir);
	assert.equal((await lstat(dir)).mode & 0o777, 0o700);

	const link = join(parent, "link");
	await symlink(dir, link);
	await assert.rejects(prepareSshControlDirectory(link), /not a directory owned by this user/);
});
