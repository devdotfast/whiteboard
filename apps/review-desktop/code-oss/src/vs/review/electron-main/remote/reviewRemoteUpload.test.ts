/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import type { SpawnSsh, SshChildProcess } from "./reviewRemoteHost.js";
import { reviewSshSession } from "./reviewSshCommand.js";
import { uploadFile } from "./reviewRemoteUpload.js";

const roots: string[] = [];

after(async () => {
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporary(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "wb upload "));
	roots.push(root);
	return root;
}

const localSsh =
	({ rewrite = (command: string) => command, seen = () => {} }: { rewrite?: (command: string) => string; seen?: (command: string, child: SshChildProcess) => void } = {}): SpawnSsh =>
	(args, options) => {
		const command = args.slice(args.indexOf("--") + 2).join(" ");
		const child = spawn("/bin/sh", ["-c", rewrite(command)], options);
		seen(command, child);
		return child;
	};

const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
const session = reviewSshSession("devbox", tmpdir());

async function fixture(bytes = 4 << 20) {
	const root = await temporary();
	const local = join(root, "local.bin");
	const content = randomBytes(bytes);
	await writeFile(local, content);
	return { root, local, content, target: join(root, "remote file.tgz") };
}

test("the file lands under its name with every byte, and progress reaches the whole size", async () => {
	const { root, local, content, target } = await fixture();
	const progress: number[] = [];

	const sent = await uploadFile(session, local, target, { spawn: localSsh(), env, onProgress: (bytes) => progress.push(bytes) });

	assert.deepEqual(sent, { sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length });
	assert.deepEqual(await readFile(target), content);
	assert.deepEqual((await readdir(root)).sort(), ["local.bin", "remote file.tgz"]);
	assert.equal(progress.at(-1), content.length);
	assert.deepEqual(progress, [...progress].sort((a, b) => a - b));
});

test("an upload whose ssh ends halfway leaves only the .part file", async () => {
	const { root, local, target } = await fixture(32 << 20);
	let upload: SshChildProcess | undefined;
	const spawnSsh = localSsh({
		seen: (command, child) => {
			if (command.includes("cat")) upload = child;
		},
	});

	await assert.rejects(
		uploadFile(session, local, target, {
			spawn: spawnSsh,
			env,
			onProgress: (sent, total) => {
				if (sent > total / 2) upload?.kill("SIGKILL");
			},
		}),
		/upload of .* to devbox/,
	);

	assert.deepEqual((await readdir(root)).sort(), ["local.bin", "remote file.tgz.part"]);
});

test("a slow remote that keeps reading is not a stall, and one that stops reading is", async () => {
	const { local, content, target } = await fixture(1 << 20);
	const slow = localSsh({
		rewrite: (command) =>
			command.replace(
				'cat > "$1.part"',
				': > "$1.part"; while n=$(dd bs=65536 count=1 2>/dev/null | tee -a "$1.part" | wc -c) && [ $n -gt 0 ]; do sleep 0.2; done',
			),
	});

	await uploadFile(session, local, target, { spawn: slow, env, timeouts: { stall: 1_000 } });
	assert.deepEqual(await readFile(target), content);

	const stopped = localSsh({ rewrite: (command) => command.replace('cat > "$1.part"', 'sleep 2; cat > "$1.part"') });
	await assert.rejects(
		uploadFile(session, local, `${target}.2`, { spawn: stopped, env, timeouts: { stall: 300 } }),
		/stalled: ssh took nothing from its stdin/,
	);
});

test("a remote without sha256sum checks the file with openssl", async () => {
	const { local, content, target } = await fixture();
	const spawnSsh = localSsh({ rewrite: (command) => command.replace("command -v sha256sum", "command -v no-such-sha256sum") });

	const sent = await uploadFile(session, local, target, { spawn: spawnSsh, env });

	assert.equal(sent.sha256, createHash("sha256").update(content).digest("hex"));
	assert.deepEqual(await readFile(target), content);
});

test("a .part that does not match what was sent is removed, not renamed", async () => {
	const { root, local, target } = await fixture();
	const spawnSsh = localSsh({ rewrite: (command) => command.replace('cat > "$1.part"', 'cat > "$1.part"; printf x >> "$1.part"') });

	await assert.rejects(uploadFile(session, local, target, { spawn: spawnSsh, env }), /does not match/);

	assert.deepEqual(await readdir(root), ["local.bin"]);
});

test("a remote path that is relative, or holds a quote, a backslash or a control character, is refused", async () => {
	const { local } = await fixture(1);
	let spawned = false;
	const spawnSsh: SpawnSsh = (args, options) => {
		spawned = true;
		return localSsh()(args, options);
	};

	for (const path of ["relative/file", "/tmp/it's", "/tmp/a\\b", "/tmp/a\nb", "/tmp/a\u0007b"]) {
		await assert.rejects(uploadFile(session, local, path, { spawn: spawnSsh, env }), /cannot upload to/, JSON.stringify(path));
	}
	assert.equal(spawned, false);
});
