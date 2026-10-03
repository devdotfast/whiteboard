/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { REVIEW_REMOTE_ATTACH_BEGIN, REVIEW_REMOTE_ATTACH_END } from "../../common/reviewProtocol.js";
import { installedAttachScript, parseRemoteAttach, reviewRemoteAttachScript } from "./reviewRemoteAttachScript.js";

async function executable(path: string, body: string) {
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
}

/** Runs the script with /bin/sh, as a remote with only system directories on PATH would. */
function attach(home: string, shell: string, groups: string[] = []) {
	return spawnSync("/bin/sh", ["-s"], {
		input: reviewRemoteAttachScript(groups),
		encoding: "utf8",
		env: { HOME: home, SHELL: shell, PATH: "/usr/bin:/bin" },
	});
}

test("the CLI a login shell finds is used, past rc files that print paths", async (t) => {
	const home = await mkdtemp(join(tmpdir(), "wb-attach-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const bin = join(home, ".nvm/versions/node/v24/bin");
	await mkdir(bin, { recursive: true });
	await executable(join(bin, "whiteboard"), 'echo "attached: $*"');
	// An nvm user's rc files print their own paths, before and after the CLI's.
	await executable(join(home, "login-shell"), `echo /etc/profile.d/banner.sh\necho ${bin}/whiteboard\necho /home/u/.nvm/nvm.sh`);

	const result = attach(home, join(home, "login-shell"));

	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "attached: remote attach --json\n");
});

test("with no CLI anywhere the script exits 127", async (t) => {
	const home = await mkdtemp(join(tmpdir(), "wb-attach-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	await executable(join(home, "login-shell"), "echo /home/u/.nvm/nvm.sh");

	assert.equal(attach(home, join(home, "login-shell")).status, 127);
});

test("the Desktop's enabled extension groups reach the CLI, and nothing else can", async (t) => {
	const home = await mkdtemp(join(tmpdir(), "wb-attach-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	await mkdir(join(home, ".local/bin"), { recursive: true });
	await executable(join(home, ".local/bin/whiteboard"), 'echo "attached: $*"');

	assert.equal(attach(home, "/bin/false", ["go", "rust"]).stdout, "attached: remote attach --json --groups go,rust\n");
	assert.throws(() => reviewRemoteAttachScript(["go; rm -rf ~"]), /Invalid extension group/);
});

test("the installed CLI's attach carries --replace and the groups; the PATH CLI never gets --replace", () => {
	assert.equal(installedAttachScript("/n/node", "/v/cli.js", ["go", "rust"]), "exec '/n/node' '/v/cli.js' remote attach --json --replace --groups go,rust\n");
	assert.equal(installedAttachScript("/n/node", "/v/cli.js"), "exec '/n/node' '/v/cli.js' remote attach --json --replace\n");
	assert.throws(() => installedAttachScript("/n/node", "/v/cli.js", ["go rust"]), /Invalid extension group/);
	assert.doesNotMatch(reviewRemoteAttachScript(["go"]), /--replace/);
});

test("one attach line with the language server, its groups, a replaced server and one left running is read whole", () => {
	const line = {
		event: "remote.attach",
		version: "0.1.7",
		serverId: "0199a3f2-7c1e-7d4a-9b2f-3e5d6c7b8a90",
		url: "http://127.0.0.1:41234",
		token: "remote-token",
		languageServer: { port: 45678, connectionToken: "vscode-token", commit: "a".repeat(40) },
		languageGroups: [{ group: "go", installed: false, detail: "go was not found on the login shell's PATH" }],
		replaced: true,
		previousVersion: "0.1.6",
		incompatibleRunning: { version: "0.1.8", pid: 7, startedBy: "desktop" },
	};

	assert.deepEqual(parseRemoteAttach(`${REVIEW_REMOTE_ATTACH_BEGIN}\n${JSON.stringify(line)}\n${REVIEW_REMOTE_ATTACH_END}\n`), {
		attach: {
			version: "0.1.7",
			serverId: line.serverId,
			token: "remote-token",
			port: 41234,
			languageServer: line.languageServer,
			languageGroups: line.languageGroups,
			replaced: "0.1.6",
			incompatibleRunning: { version: "0.1.8", startedBy: "desktop" },
		},
	});
});
