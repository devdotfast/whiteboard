/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type { VSBuffer } from "../../base/common/buffer.js";
import { Event } from "../../base/common/event.js";
import { URI } from "../../base/common/uri.js";
import { ReviewCanvasEditorInput } from "../browser/parts/canvas/reviewCanvasEditorInput.js";
import { ReviewHostDown } from "../browser/parts/canvas/reviewHostFailure.js";
import { apiSourceUri } from "../common/reviewSourceView.js";
import { ReviewCanvasEditorTabsService } from "./reviewCanvasEditorTabsService.js";

async function closeWelcome(updateNeeded: boolean): Promise<number> {
	let finished = 0;
	const instantiation = {
		createInstance(_ctor: unknown, target: never) {
			return new ReviewCanvasEditorInput(target, {} as never);
		},
	};
	const editors = { onDidCloseEditor: Event.None, async openEditor() {} };
	const groups = { groups: [], mainPart: { activeGroup: undefined } };
	const connection = {
		async getCliInstallStatus() {
			return { updateNeeded };
		},
		async finishCliInstallUpdate() {
			finished += 1;
		},
	};
	const tabs = new ReviewCanvasEditorTabsService(
		instantiation as never,
		editors as never,
		groups as never,
		connection as never,
		{} as never,
		{ warn() {} } as never,
		{} as never,
		{} as never,
		{} as never,
	);
	try {
		const welcome = await tabs.openWelcome(true);
		welcome.dispose();
		await new Promise((resolve) => setImmediate(resolve));
		return finished;
	} finally {
		tabs.dispose();
	}
}

test("closing Welcome finishes the CLI install update only when one is pending", async () => {
	assert.equal(await closeWelcome(true), 1);
	assert.equal(await closeWelcome(false), 0);
});

const HOST = "whiteboard+c0ffee";
const remote = (path: string) => URI.from({ scheme: "vscode-remote", authority: HOST, path }).toString();
const view = (generation?: string) => ({ reviewId: "r1", version: 2, generation });

function sourceTabs(t: TestContext, answer: (url: URL) => object, openFilesIn = "whiteboard") {
	const opened: { toOpen: { workspaceUri?: URI; fileUri?: URI; label?: string }[]; options: Record<string, unknown> }[] = [];
	const written: string[] = [];
	t.mock.method(globalThis, "fetch", async (url: string) => Response.json(answer(new URL(url))));
	const tabs = new ReviewCanvasEditorTabsService(
		{ createInstance: (_ctor: unknown, target: never) => new ReviewCanvasEditorInput(target, {} as never) } as never,
		{ onDidCloseEditor: Event.None } as never,
		{} as never,
		{ async getConnection() { return { serverUrl: "http://localhost", token: "test" }; }, async readRemoteHosts() { return []; } } as never,
		{ async openWindow(toOpen: never, options: never) { opened.push({ toOpen, options }); } } as never,
		{ warn() {} } as never,
		{ async writeFile(resource: URI, content: VSBuffer) { written.push(`${resource.toString()}=${content.toString()}`); } } as never,
		{ cacheHome: URI.file("/laptop/cache") } as never,
		{ getValue: () => openFilesIn } as never,
	);
	t.after(() => tabs.dispose());
	return { tabs, opened, written };
}

const remoteAnswer = {
	workspacePath: "/home/dev/navigator/repo.code-workspace",
	filePath: "/home/dev/repo/src/a b.ts",
	serverId: "C0FFEE",
};

test("a remote answer opens the host's workspace and file at the position, titled with the review", async (t) => {
	const { tabs, opened } = sourceTabs(t, () => remoteAnswer);
	tabs.inputFor({ kind: "api", reviewId: "r1", title: "Fix the parser" });
	const resource = apiSourceUri({ view: view(), side: "head", file: "src/a b.ts" });
	assert.equal(await tabs.openSourceEditor({ resource, options: { selection: { startLineNumber: 3, startColumn: 2 } } }), true);
	const [{ toOpen, options }] = opened;
	assert.deepEqual(toOpen.map(item => (item.workspaceUri ?? item.fileUri)!.toString()), [remote("/home/dev/navigator/repo.code-workspace"), remote("/home/dev/repo/src/a b.ts:3:2")]);
	assert.equal(options.remoteAuthority, HOST);
});

test("a remote file opens on its host even when files open in another editor", async (t) => {
	const { tabs, opened } = sourceTabs(t, () => remoteAnswer, "zed");
	await tabs.openSourceEditor({ resource: apiSourceUri({ view: view(), side: "head", file: "src/a b.ts" }) });
	assert.equal(opened[0].options.remoteAuthority, HOST);
});

test("a remote diff opens its empty side from a laptop empty file", async (t) => {
	const { tabs, opened, written } = sourceTabs(t, url => url.searchParams.has("empty")
		? { workspacePath: remoteAnswer.workspacePath, serverId: remoteAnswer.serverId, emptySide: true }
		: remoteAnswer);
	await tabs.openSourceEditor({
		original: { resource: apiSourceUri({ view: view("wt1"), side: "base", file: "src/a b.ts" }, true) },
		modified: { resource: apiSourceUri({ view: view("wt1"), side: "head", file: "src/a b.ts" }) },
	});
	const empty = URI.file("/laptop/cache/source-empty/empty");
	assert.deepEqual(written, [`${empty.toString()}=`]);
	const [{ toOpen, options }] = opened;
	assert.deepEqual(toOpen.map(item => (item.workspaceUri ?? item.fileUri)!.toString()), [
		remote("/home/dev/navigator/repo.code-workspace"),
		empty.with({ scheme: "vscode-userdata" }).toString(),
		remote("/home/dev/repo/src/a b.ts"),
	]);
	assert.equal(options.remoteAuthority, HOST);
	assert.equal(options.diffMode, true);
});

test("a gateway 503 naming a host is that host's error", async (t) => {
	const { tabs } = sourceTabs(t, () => remoteAnswer);
	t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: "gateway text" }, { status: 503, headers: { "x-review-host": "devbox" } }));
	await assert.rejects(tabs.openApiSource({ reviewId: "r1", kind: "current" }, "Fix the parser"), (error: unknown) =>
		error instanceof ReviewHostDown && error.host.alias === "devbox" && error.host.state === "offline");
});
