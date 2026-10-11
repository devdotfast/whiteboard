/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { launchApplication, launchExternalEditorUrl, launchZedWorkspace } from "./reviewExternalEditorLauncher.js";

const whiteboardEnv = {
	PATH: "/usr/bin:/opt/homebrew/bin",
	HOME: "/Users/reader",
	LANG: "en_US.UTF-8",
	VSCODE_DEV: "1",
	VSCODE_CLI: "1",
	VSCODE_CWD: "/Applications/Whiteboard.app",
	VSCODE_PORTABLE: "/whiteboard/data",
	VSCODE_NLS_CONFIG: "{}",
	ELECTRON_RUN_AS_NODE: "1",
	ELECTRON_ENABLE_LOGGING: "1",
	NODE_ENV: "development",
	NODE_OPTIONS: "--inspect",
	DEV_FAST_REVIEW_CHECKOUT: "/src/whiteboard",
	DEV_REVIEW_SERVER_DIR: "/whiteboard/state",
};

function fakeOpener(exit: { code: number; stderr?: string } | "running") {
	const calls: { command: string; args: string[]; env: Record<string, string> }[] = [];
	let unref = false;
	const spawn = (command: string, args: string[], options: { env: Record<string, string> }) => {
		calls.push({ command, args, env: options.env });
		const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), unref: () => { unref = true; } });
		if (exit !== "running") {
			setImmediate(() => {
				if (exit.stderr) child.stderr.write(exit.stderr);
				setImmediate(() => child.emit("exit", exit.code));
			});
		}
		return child;
	};
	return { spawn: spawn as never, calls, unrefed: () => unref };
}

test("the editor starts without Whiteboard's Electron, Code-OSS or dev variables", async () => {
	const opener = fakeOpener({ code: 0 });
	await launchExternalEditorUrl("cursor://file/repo/a.ts:4:1", { spawn: opener.spawn, platform: "darwin", env: whiteboardEnv });

	assert.deepEqual(opener.calls[0].env, { PATH: "/usr/bin:/opt/homebrew/bin", HOME: "/Users/reader", LANG: "en_US.UTF-8" });
	assert.ok(opener.calls[0].args.includes("cursor://file/repo/a.ts:4:1"));
});

test("an opener that cannot hand off the URL reports why", async () => {
	const opener = fakeOpener({ code: 1, stderr: "No application knows how to open URL zed://file/a.ts\n" });
	await assert.rejects(
		launchExternalEditorUrl("zed://file/a.ts", { spawn: opener.spawn, platform: "darwin", env: whiteboardEnv }),
		/No application knows how to open URL/,
	);
});

test("an opener that stays in the foreground is left running", async () => {
	const opener = fakeOpener("running");
	await launchExternalEditorUrl("vscode://file/a.ts", { spawn: opener.spawn, platform: "linux", env: whiteboardEnv, settleMs: 1 });
	assert.equal(opener.unrefed(), true);
});

test("a picked application gets the file with the same clean environment", async () => {
	const opener = fakeOpener({ code: 0 });
	await launchApplication("/Applications/TextEdit.app", "/repo/my file.ts", { spawn: opener.spawn, platform: "darwin", env: whiteboardEnv });

	assert.deepEqual(opener.calls[0].env, { PATH: "/usr/bin:/opt/homebrew/bin", HOME: "/Users/reader", LANG: "en_US.UTF-8" });
	assert.deepEqual(opener.calls[0].args.slice(-2), ["/Applications/TextEdit.app", "/repo/my file.ts"]);
});

test("Zed's command line from the app that handles zed:// gets the folder and the file", async () => {
	const opener = fakeOpener({ code: 0 });
	const launched = await launchZedWorkspace("/repo", "/repo/a.ts:4:1", {
		spawn: opener.spawn,
		platform: "darwin",
		env: whiteboardEnv,
		zedApplication: async () => "/Applications/Zed Preview.app",
		exists: () => true,
	});

	assert.equal(launched, true);
	assert.equal(opener.calls[0].command, "/Applications/Zed Preview.app/Contents/MacOS/cli");
	assert.deepEqual(opener.calls[0].args, ["/repo", "/repo/a.ts:4:1"]);
	assert.equal(opener.calls[0].env.VSCODE_DEV, undefined);
});

test("without Zed's command line nothing starts", async () => {
	const opener = fakeOpener({ code: 0 });
	const options = { spawn: opener.spawn, env: whiteboardEnv, exists: () => false };

	assert.equal(await launchZedWorkspace("/repo", "/repo/a.ts", { ...options, platform: "darwin", zedApplication: async () => undefined }), false);
	assert.equal(await launchZedWorkspace("/repo", "/repo/a.ts", { ...options, platform: "darwin", zedApplication: async () => "/Applications/Zed.app" }), false);
	assert.equal(await launchZedWorkspace("/repo", "/repo/a.ts", { ...options, platform: "linux", exists: () => true }), false);
	assert.equal(opener.calls.length, 0);
});
