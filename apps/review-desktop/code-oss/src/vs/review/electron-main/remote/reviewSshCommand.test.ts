/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
	prepareSshControlDirectory,
	reviewSshConfigPath,
	reviewSshControlDirectory,
	reviewSshDirectSession,
	reviewSshInstancePrefix,
	reviewSshSession,
	reviewSshSharesConnections,
	sshCancelForwardArgs,
	sshCheckArgs,
	sshCloseArgs,
	sshExecArgs,
	sshForwardArgs,
	sshMasterArgs,
} from "./reviewSshCommand.js";
import { validateSshAlias } from "../../common/reviewSshAlias.js";

const session = { alias: "wb-test-a", controlPath: "/tmp/wb-ssh-501/0123456789ab" };

const allArgs = (env: NodeJS.ProcessEnv = {}) => [
	sshMasterArgs(session, env),
	sshExecArgs(session, env),
	sshForwardArgs(session, 41000, 42000, env),
	sshCancelForwardArgs(session, 41000, 42000, env),
	sshCloseArgs(session, env),
	sshCheckArgs(session, env),
];

test("refuses aliases that could become options or reach a shell", () => {
	for (const alias of ["-oProxyCommand=x", "a b", "a`id`", "", "a\u0001b", "a$HOME", "a;b", "a|b", "a&b", "a<b", "a>b", "a(b", "a)b", "a'b", 'a"b', "a\\b"])
		assert.equal(validateSshAlias(alias).ok, false, JSON.stringify(alias));
});

test("accepts ordinary aliases", () => {
	for (const alias of ["wb-test-a", "dev@build.example.com", "box_2", "10.0.0.7", "a-"])
		assert.deepEqual(validateSshAlias(alias), { ok: true }, alias);
});

test("a session refuses an invalid alias", () => {
	assert.throws(() => reviewSshSession("-oProxyCommand=x", "/tmp/d", "test"), /starts with -/);
});

test("a direct session never prompts, keeps host-key checking, and has no control socket", () => {
	const direct = reviewSshDirectSession("wb-test-a");
	const env = { DEV_FAST_REVIEW_SSH_CONFIG: "/tmp/c", VSCODE_DEV: "1" };
	for (const args of [sshMasterArgs(direct, env, 41000), sshExecArgs(direct, env)]) {
		assert.deepEqual(args.slice(0, 3), ["-F", "/tmp/c", "-oBatchMode=yes"]);
		for (const arg of args) assert.doesNotMatch(arg, /^-[SOM]$|StrictHostKeyChecking|UserKnownHostsFile|ControlMaster/);
	}
	assert.throws(() => sshMasterArgs(direct, env), /Invalid port/);
	for (const build of [() => sshForwardArgs(direct, 1, 2, env), () => sshCheckArgs(direct, env), () => sshCloseArgs(direct, env)])
		assert.throws(build);
});

test("only Windows and the development switch make sessions direct", () => {
	assert.equal(reviewSshSharesConnections({}, "darwin"), true);
	assert.equal(reviewSshSharesConnections({}, "win32"), false);
	assert.equal(reviewSshSharesConnections({ DEV_FAST_REVIEW_SSH_DIRECT: "1", VSCODE_DEV: "1" }, "linux"), false);
	assert.equal(reviewSshSharesConnections({ DEV_FAST_REVIEW_SSH_DIRECT: "1" }, "linux"), true);
	assert.equal(reviewSshSharesConnections({ DEV_FAST_REVIEW_SSH_DIRECT: "0", VSCODE_DEV: "1" }, "linux"), true);
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
	const instance = "/Users/u/Library/Application Support/Whiteboard";
	const { controlPath } = reviewSshSession(alias, reviewSshControlDirectory(), instance);
	assert.ok(Buffer.byteLength(controlPath) < 100, controlPath);
	assert.ok(controlPath.startsWith(reviewSshControlDirectory()));
	assert.ok(basename(controlPath).startsWith(reviewSshInstancePrefix(instance)));
	assert.notEqual(reviewSshSession("b".repeat(40), reviewSshControlDirectory(), instance).controlPath, controlPath);
	assert.ok(!basename(reviewSshSession(alias, reviewSshControlDirectory(), `${instance} Preview`).controlPath).startsWith(reviewSshInstancePrefix(instance)));
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
