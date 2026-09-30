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
	sshCloseArgs(session, env),
];

test("refuses aliases that could become options or reach a shell", () => {
	for (const [alias, reason] of [
		["-oProxyCommand=x", "starts with -"],
		["a b", "contains whitespace"],
		["a`id`", "contains `"],
		["", "is empty"],
		["a\tb", "contains whitespace"],
		["a\u0001b", "contains a control character"],
		["a$HOME", "contains $"],
		["a;b", "contains ;"],
		["a|b", "contains |"],
		["a&b", "contains &"],
		["a<b", "contains <"],
		["a>b", "contains >"],
		["a(b", "contains ("],
		["a)b", "contains )"],
		["a'b", "contains '"],
		['a"b', 'contains "'],
		["a\\b", "contains \\"],
	]) assert.deepEqual(validateSshAlias(alias), { ok: false, reason }, JSON.stringify(alias));
});

test("accepts ordinary aliases", () => {
	for (const alias of ["wb-test-a", "dev@build.example.com", "box_2", "10.0.0.7", "a-"])
		assert.deepEqual(validateSshAlias(alias), { ok: true }, alias);
});

test("a session refuses an invalid alias", () => {
	assert.throws(() => reviewSshSession("-oProxyCommand=x", "/tmp/d"), /starts with -/);
});

test("every argument list ends with -- and the alias, and exec with the fixed command after it", () => {
	const [master, exec, forward, close] = allArgs();
	assert.deepEqual(master.slice(-2), ["--", "wb-test-a"]);
	assert.deepEqual(exec.slice(-4), ["--", "wb-test-a", "sh", "-s"]);
	assert.deepEqual(forward.slice(-2), ["--", "wb-test-a"]);
	assert.deepEqual(close.slice(-2), ["--", "wb-test-a"]);
	for (const args of allArgs()) assert.equal(args.indexOf("--"), args.lastIndexOf("--"));
});

test("no argument list overrides host-key checking or prompting", () => {
	for (const args of allArgs({ DEV_FAST_REVIEW_SSH_CONFIG: "/tmp/c", VSCODE_DEV: "1" }))
		for (const arg of args) assert.doesNotMatch(arg, /StrictHostKeyChecking|UserKnownHostsFile|BatchMode/i);
});

test("the exec, forward and close reuse the session's control path", () => {
	const [, exec, forward, close] = allArgs();
	for (const args of [exec, forward, close]) {
		const i = args.indexOf("-S");
		assert.equal(args[i + 1], session.controlPath);
	}
	assert.ok(exec.includes("-oControlMaster=no"));
	assert.ok(forward.includes("-oControlMaster=no"));
});

test("the forward binds loopback on both ends", () => {
	const forward = sshForwardArgs(session, 41000, 42000, {});
	assert.equal(forward[forward.indexOf("-L") + 1], "127.0.0.1:41000:127.0.0.1:42000");
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
