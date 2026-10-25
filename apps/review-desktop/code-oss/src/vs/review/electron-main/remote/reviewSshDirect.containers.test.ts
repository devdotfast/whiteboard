/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { runSsh, type SpawnSsh } from "./reviewRemoteHost.js";
import { freeLoopbackPort } from "./reviewRemoteHosts.js";
import { socksAnswers, socksForward } from "./reviewSocksForward.js";
import { REVIEW_SSH_CONFIG_ENV, reviewSshDirectSession, sshExecArgs, sshMasterArgs } from "./reviewSshCommand.js";

const run = promisify(execFile);
const harness = resolve(import.meta.dirname, "../../../../../../scripts/e2e/remote/remote.mjs");

function skipReason(): string | undefined {
	if (process.env.WB_TEST_CONTAINERS !== "1") return "set WB_TEST_CONTAINERS=1 to run direct SSH against a container";
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
	} catch {
		return "Docker is not available";
	}
	return undefined;
}

const skip = skipReason();
const runId = `direct${randomBytes(3).toString("hex")}`;
const session = reviewSshDirectSession("wb-test-a");
const env = { ...process.env, VSCODE_DEV: "1", [REVIEW_SSH_CONFIG_ENV]: `/tmp/wbt.${runId}/ssh_config` };
const realSsh: SpawnSsh = (args, options) => spawn("ssh", args, options);
const remote = (args: string[]) => run(process.execPath, [harness, ...args], { env: { ...process.env, WB_TEST_RUN: runId }, maxBuffer: 16 << 20 });

async function readAll(port: number): Promise<string> {
	let text = "";
	for await (const chunk of connect(port, "127.0.0.1")) {
		text += chunk;
		if (text.includes("\n")) break;
	}
	return text;
}

before(async () => void (skip || (await remote(["up", "a", "--node", "none"]))), { timeout: 20 * 60_000 });
after(async () => void (skip || (await remote(["down", "--all"]))), { timeout: 5 * 60_000 });

test("an exec opens its own connection without prompting", { skip }, async () => {
	const result = await runSsh(realSsh, env, sshExecArgs(session, env), 30_000, "echo direct-ok\n");
	assert.equal(result.stdout.trim(), "direct-ok", result.stderr);
});

test("a direct master serves SOCKS once logged in, and a forward reaches the host", { skip }, async (t) => {
	const socksPort = await freeLoopbackPort();
	const master = spawn("ssh", sshMasterArgs(session, env, socksPort), { env, stdio: ["ignore", "ignore", "pipe"] });
	t.after(() => master.kill());
	const deadline = Date.now() + 30_000;
	while (!(await socksAnswers(socksPort))) {
		assert.equal(master.exitCode, null, "the master exited");
		assert.ok(Date.now() < deadline, "no SOCKS port within 30 seconds");
		await new Promise((done) => setTimeout(done, 250));
	}

	const sshd = await socksForward(socksPort, 22);
	t.after(() => sshd.close());
	assert.match(await readAll(sshd.port), /^SSH-2\.0-/);
});
