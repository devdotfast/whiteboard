/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SpawnSsh } from "./reviewRemoteHost.js";
import { REVIEW_REMOTE_INSTALL_MARKER } from "./reviewRemoteInstallScript.js";
import { uninstallRemote } from "./reviewRemoteUninstall.js";
import { reviewSshSession } from "./reviewSshCommand.js";

const localRemote =
	(home: string): SpawnSsh =>
	(args, options) =>
		spawn("/bin/sh", ["-c", args.slice(args.indexOf("--") + 2).join(" ")], { ...options, env: { HOME: home, PATH: "/usr/bin:/bin" } });

async function fixture(t: test.TestContext) {
	const home = await mkdtemp(join(tmpdir(), "wb uninstall-"));
	t.after(() => rm(home, { recursive: true, force: true }));
	const ran = join(home, "ran");
	const version = async (name: string, cli: string) => {
		const dir = join(home, ".dev/whiteboard-remote/versions", name);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "cli.js"), cli);
		await writeFile(join(dir, REVIEW_REMOTE_INSTALL_MARKER), JSON.stringify({ version: name, node: process.execPath, cli: join(dir, "cli.js") }));
	};
	const uninstall = () => uninstallRemote({ session: reviewSshSession("devbox", tmpdir()), spawn: localRemote(home), env: {} });
	return { home, ran, version, uninstall };
}

test("runs the newest version's own remote uninstall, keeping reviews", async (t) => {
	const f = await fixture(t);
	await f.version("0.9.0", `require("fs").writeFileSync(${JSON.stringify(f.ran)}, "old")`);
	await f.version(
		"0.10.0",
		`require("fs").writeFileSync(${JSON.stringify(f.ran)}, process.argv.slice(2).join(" "));
console.log("banner");
console.log(JSON.stringify({ event: "remote.uninstall", ok: true, removed: [], keptReviews: true }));`,
	);

	await f.uninstall();

	assert.equal(await readFile(f.ran, "utf8"), "remote uninstall --keep-reviews --json");
});

test("rejects with the reason the remote gave, on one line and bounded", async (t) => {
	const f = await fixture(t);
	await f.version("0.10.0", `console.log(JSON.stringify({ event: "remote.uninstall", ok: false, reason: "A Whiteboard server you started (process 7)\\n\\u001b[31mruns from it." }))`);

	await assert.rejects(f.uninstall(), { message: "Could not remove Whiteboard from devbox: A Whiteboard server you started (process 7) [31mruns from it." });

	await f.version("0.10.0", `console.log(JSON.stringify({ event: "remote.uninstall", ok: false, reason: "x".repeat(5000) }))`);
	await assert.rejects(f.uninstall(), { message: `Could not remove Whiteboard from devbox: ${"x".repeat(300)}` });
});

test("rejects when nothing is installed, or the command fails", async (t) => {
	const f = await fixture(t);
	await assert.rejects(f.uninstall(), { message: "Could not remove Whiteboard from devbox: Whiteboard Desktop installed nothing there." });

	await f.version("0.10.0", `console.error("error: unknown command 'uninstall'"); process.exit(1)`);
	await assert.rejects(f.uninstall(), { message: "Could not remove Whiteboard from devbox: exit 1: error: unknown command 'uninstall'." });
});
