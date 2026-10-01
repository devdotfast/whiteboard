/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseRemoteAgents, parseRemoteConnect, remoteConnectScript } from "./reviewRemoteAgents.js";

test("detection keeps only known agents, once each, and nothing the remote adds", () => {
	const stdout = [
		"Welcome to Ubuntu",
		JSON.stringify({ event: "connect.detect", agents: [] }),
		JSON.stringify({
			event: "connect.detect",
			agents: [
				{ id: "pi", name: "\u001b[31mEvil\u001b[0m", present: true, connected: false, manual: "yes", configPath: "/home/dev/.pi" },
				{ id: "claude", name: "Claude Code", present: true, connected: true },
				{ id: "pi", present: true, connected: true },
				{ id: "cursor", present: true, connected: false },
				{ id: "codex", present: true, connected: "no" },
				{ id: "opencode", present: false, connected: false },
				{ id: "__proto__", present: true, connected: false },
				"codex",
				null,
			],
		}),
		"bye",
	].join("\n");

	assert.deepEqual(parseRemoteAgents(stdout), [
		{ id: "claude", connected: true },
		{ id: "pi", connected: false },
	]);
	assert.deepEqual(parseRemoteAgents(JSON.stringify({ event: "connect.detect", agents: [{ id: "codex", present: true, connected: false, manual: true }] })), [
		{ id: "codex", connected: false, manual: true },
	]);
	assert.equal(parseRemoteAgents("bash: whiteboard: command not found\n"), undefined);
	assert.equal(parseRemoteAgents(JSON.stringify({ event: "connect.detect", agents: "all" })), undefined);
	// A list longer than any real one is cut before it is read.
	const many = Array.from({ length: 10_000 }, () => ({ id: "codex", present: true, connected: false }));
	assert.deepEqual(parseRemoteAgents(JSON.stringify({ event: "connect.detect", agents: [...many, { id: "pi", present: true, connected: true }] })), [
		{ id: "codex", connected: false },
	]);
});

test("a connect result's output is plain text, and bounded", () => {
	const [result] = parseRemoteConnect(
		JSON.stringify({ event: "connect.run", agents: [{ id: "pi", connected: false, output: `\u001b[31mnpm ERR!\u001b[0m\r\n404\u0007 ${"x".repeat(5000)}` }] }),
	)!;

	assert.equal(result.id, "pi");
	assert.equal(result.connected, false);
	assert.ok(result.output.length <= 1000);
	assert.doesNotMatch(result.output, /[\x00-\x1f\x7f-\x9f]/);
	assert.equal(parseRemoteConnect(JSON.stringify({ event: "connect.run", agents: [{ id: "pi", connected: true }] }))![0].output, "");
});

/** Runs the script with `sh -s` in a fake home: `node` and `whiteboard` print their argv and PATH. */
async function runScript(t: test.TestContext, script: (home: string) => string, shellNoise = "motd\n"): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "wb-agents-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const echo = '#!/bin/sh\nprintf "%s|" "$0" "$@"; printf "\\nPATH=%s DELEGATE=%s\\n" "$PATH" "$DEV_FAST_REVIEW_CLI_NO_DELEGATE"\n';
	await mkdir(join(home, ".local", "bin"), { recursive: true });
	for (const file of [join(home, "node"), join(home, ".local", "bin", "whiteboard")]) {
		await writeFile(file, echo);
		await chmod(file, 0o755);
	}
	// A login shell with start-up output, whose PATH holds the agents' commands.
	const shell = join(home, "login-shell");
	await writeFile(shell, `#!/bin/sh\nprintf '${shellNoise}'\nPATH=/agents/bin:$PATH\nexport PATH\nshift\nexec /bin/sh -c "$1"\n`);
	await chmod(shell, 0o755);
	return new Promise((resolve, reject) => {
		const child = execFile("/bin/sh", ["-s"], { env: { HOME: home, SHELL: shell, PATH: "/usr/bin:/bin" } }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
		child.stdin!.end(script(home));
	});
}

test("the installed CLI runs by its paths, with the login shell's PATH, as itself", async (t) => {
	const out = await runScript(t, (home) => remoteConnectScript({ nodePath: join(home, "node"), cliPath: "/opt/wb/it's/cli.js" }, ["--yes", "--json", "pi"]), "Welcome\nWHITEBOARD-PATH=/not/this\n");

	const [argv, env] = out.trim().split("\n");
	assert.match(argv, /\/node\|\/opt\/wb\/it's\/cli\.js\|connect\|--yes\|--json\|pi\|$/);
	assert.match(env, /^PATH=\/agents\/bin:\/usr\/bin:\/bin:\/usr\/bin:\/bin DELEGATE=1$/);
});

test("without an installed CLI, the one on PATH or in ~/.local/bin runs", async (t) => {
	const out = await runScript(t, () => remoteConnectScript(undefined, ["--detect", "--json"]));

	assert.match(out, /\/\.local\/bin\/whiteboard\|connect\|--detect\|--json\|/);
	assert.match(out, /DELEGATE=1/);
});
