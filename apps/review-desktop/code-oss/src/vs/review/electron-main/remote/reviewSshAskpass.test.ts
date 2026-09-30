/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { sshPromptKind, type SshPromptKind } from "../../common/reviewSshPrompt.js";
import { createSshAskpass, type SshPromptRequest } from "./reviewSshAskpass.js";

const helper = [process.execPath, "--import", "tsx", fileURLToPath(new URL("../../node/reviewSshAskpassMain.ts", import.meta.url))];

const passphrase = "Enter passphrase for key '/home/u/.ssh/id_ed25519': ";
const password = "dev@127.0.0.1's password: ";
const hostKey = "Are you sure you want to continue connecting (yes/no/[fingerprint])? ";
const code = "Verification code: ";

async function listener(t: TestContext, prompt: (request: SshPromptRequest) => Promise<string | undefined>) {
	const directory = await mkdtemp(join(tmpdir(), "wb-askpass-"));
	const log: string[] = [];
	const askpass = await createSshAskpass({ directory, prompt, helper, log: (message) => log.push(message) });
	t.after(async () => {
		askpass.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	return { askpass, directory, log };
}

/** Runs the askpass program the way ssh does: the prompt as its only argument, the answer on stdout. */
function runAskpass(env: Record<string, string>, text: string, command = [env.SSH_ASKPASS]): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command[0], [...command.slice(1), text], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (exitCode) => resolve({ code: exitCode, stdout, stderr }));
	});
}

test("the helper prints the answer with no newline and exits 0, and the log never holds the answer", async (t) => {
	const seen: { alias: string; text: string; kind: SshPromptKind }[] = [];
	const { askpass, log } = await listener(t, async ({ alias, text, kind }) => {
		seen.push({ alias, text, kind });
		return "correct horse";
	});

	const result = await runAskpass(askpass.env("wb-test-a"), password);

	assert.deepEqual(result, { code: 0, stdout: "correct horse", stderr: "" });
	assert.deepEqual(seen, [{ alias: "wb-test-a", text: password, kind: "secret" }]);
	assert.ok(log.some((line) => line.includes("secret") && line.includes("wb-test-a") && line.includes("answered")), log.join("\n"));
	assert.ok(!log.join("\n").includes("correct horse"));
});

test("a cancelled prompt makes the helper exit non-zero and print nothing", async (t) => {
	const { askpass, log } = await listener(t, async () => undefined);

	const result = await runAskpass(askpass.env("wb-test-a"), password);

	assert.notEqual(result.code, 0);
	assert.equal(result.stdout, "");
	assert.ok(log.some((line) => line.includes("cancelled")), log.join("\n"));
});

test("after a cancel, the same ssh process is not asked again", async (t) => {
	let shown = 0;
	const { askpass } = await listener(t, async () => {
		shown++;
		return undefined;
	});

	// Both runs have this test process as their parent, as ssh's retries share ssh.
	assert.notEqual((await runAskpass(askpass.env("wb-test-a"), password)).code, 0);
	assert.notEqual((await runAskpass(askpass.env("wb-test-a"), password)).code, 0);
	assert.equal(shown, 1);
});

test("the helper fails without printing when the listener is gone", async (t) => {
	const { askpass, directory } = await listener(t, async () => "unused");
	const env = { ...askpass.env("wb-test-a"), DEV_FAST_REVIEW_SSH_ASKPASS_SOCKET: join(directory, "gone.sock") };

	const result = await runAskpass(env, password, helper);

	assert.deepEqual(result, { code: 1, stdout: "", stderr: "" });
});

test("OpenSSH's prompts get the right kind", () => {
	assert.equal(sshPromptKind(passphrase), "secret");
	assert.equal(sshPromptKind(password), "secret");
	assert.equal(sshPromptKind(`The authenticity of host '[127.0.0.1]:2222 ([127.0.0.1]:2222)' can't be established.\nED25519 key fingerprint is SHA256:abc.\n${hostKey}`), "confirm");
	assert.equal(sshPromptKind("Please type 'yes', 'no' or the fingerprint: "), "text");
	assert.equal(sshPromptKind(code), "text");
});

test("two hosts that prompt at the same time are asked one after the other", async (t) => {
	let active = 0;
	let most = 0;
	const order: string[] = [];
	const { askpass } = await listener(t, async ({ alias }) => {
		most = Math.max(most, ++active);
		order.push(alias);
		await new Promise((resolve) => setTimeout(resolve, 100));
		active--;
		return `answer for ${alias}`;
	});

	const [a, b] = await Promise.all([runAskpass(askpass.env("wb-test-a"), password), runAskpass(askpass.env("wb-test-b"), passphrase)]);

	assert.equal(most, 1);
	assert.deepEqual(order.toSorted(), ["wb-test-a", "wb-test-b"]);
	assert.equal(a.stdout, "answer for wb-test-a");
	assert.equal(b.stdout, "answer for wb-test-b");
});

test("the script and the socket are the owner's alone, and dispose removes both", async (t) => {
	const { askpass } = await listener(t, async () => undefined);
	const { SSH_ASKPASS: script, DEV_FAST_REVIEW_SSH_ASKPASS_SOCKET: socket } = askpass.env("wb-test-a");

	assert.equal((await lstat(script)).mode & 0o777, 0o700);
	assert.equal((await lstat(socket)).mode & 0o777, 0o600);
	assert.ok((await lstat(socket)).isSocket());

	askpass.dispose();
	assert.equal(existsSync(script), false);
	assert.equal(existsSync(socket), false);
});

test("env forces the helper, carries no answer, and refuses an invalid alias", async (t) => {
	const { askpass } = await listener(t, async () => undefined);
	const env = askpass.env("wb-test-a");

	assert.equal(env.SSH_ASKPASS_REQUIRE, "force");
	assert.ok(env.DISPLAY);
	assert.equal(env.DEV_FAST_REVIEW_SSH_ASKPASS_ALIAS, "wb-test-a");
	assert.throws(() => askpass.env("-oProxyCommand=x"), /starts with -/);
});
