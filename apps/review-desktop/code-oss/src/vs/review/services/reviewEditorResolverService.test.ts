import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { Event } from "../../base/common/event.js";
import { URI } from "../../base/common/uri.js";
import type { IOpenWindowOptions, IWindowOpenable } from "../../platform/window/common/window.js";
import { EditorResolverService } from "../../workbench/services/editor/browser/editorResolverService.js";
import { ResolvedStatus } from "../../workbench/services/editor/common/editorResolverService.js";
import { apiSourceUri } from "../common/reviewSourceView.js";
import { REVIEW_LANGUAGE_SOURCE_SCHEME } from "../common/reviewReadonlySource.js";
import { ReviewCanvasEditorTabsService } from "./reviewCanvasEditorTabsService.js";
import { ReviewEditorResolverService } from "./reviewEditorResolverService.js";

function sourceResolver(t: TestContext, options: { openFilesIn?: string; application?: string } = {}) {
	const requests: URL[] = [];
	const windows: { openables: IWindowOpenable[]; options: IOpenWindowOptions }[] = [];
	const external: unknown[] = [];
	const state = { fail: false };
	t.mock.method(globalThis, "fetch", async (url: string) => {
		const request = new URL(url);
		requests.push(request);
		if (state.fail) return Response.json({ error: "Checkout unavailable" }, { status: 409 });
		const side = request.searchParams.get("side");
		const file = request.searchParams.get("file");
		return Response.json({ workspacePath: `/navigator/${side}.code-workspace`, filePath: file ? `/navigator/${side}/${file}` : undefined, rootPath: `/navigator/${side}` });
	});
	const tabs = new ReviewCanvasEditorTabsService(
		{} as never, { onDidCloseEditor: Event.None } as never, {} as never,
		{
			async getConnection() { return { serverUrl: "http://localhost", token: "test" }; },
			async openInExternalEditor(target: unknown) { external.push(target); },
			async openInApplication(application: string, filePath: string) { external.push({ application, filePath }); },
		} as never,
		{ async openWindow(openables: IWindowOpenable[], options: IOpenWindowOptions) { windows.push({ openables, options }); } } as never,
		{ warn() {} } as never,
		{ getValue: (key: string) => ({ "review.openFilesIn": options.openFilesIn, "review.openFilesInApplication": options.application })[key] } as never,
	);
	const resolver = new ReviewEditorResolverService(
		{ get activeGroup() { throw new Error("Review must not create an editor group"); } } as never,
		{ invokeFunction: (fn: (accessor: unknown) => unknown) => fn({ get: () => tabs }) } as never,
		{} as never, {} as never, {} as never,
		{ get: () => "[]", remove() {}, onWillSaveState: Event.None } as never,
		{ onDidRegisterExtensions: Event.None } as never, {} as never,
	);
	t.after(() => { resolver.dispose(); tabs.dispose(); });
	return { resolver, requests, windows, external, state };
}

test("source tree, selected code, definitions and diffs hand off before creating a Review editor group", async (t) => {
	const { resolver, requests, windows, state } = sourceResolver(t);
	const view = { reviewId: "review-a", version: 7, commit: "selected-commit", pins: { repositoryId: "other-repository", head: "head-sha", base: "base-sha" } };
	const head = apiSourceUri({ view, side: "head", file: "nested/source.ts" });
	const base = apiSourceUri({ view, side: "base", file: "old-name.ts" });
	assert.equal(await resolver.resolveEditor({ resource: head }, undefined), ResolvedStatus.ABORT);
	assert.equal(await resolver.resolveEditor({ resource: base, options: { selection: { startLineNumber: 42, startColumn: 3 } } }, undefined), ResolvedStatus.ABORT);
	assert.deepEqual(windows[1].openables, [
		{ workspaceUri: URI.file("/navigator/base.code-workspace") },
		{ fileUri: URI.file("/navigator/base/old-name.ts:42:3") },
	]);
	assert.deepEqual(windows[1].options, { forceNewWindow: true, gotoLineMode: true, diffMode: false });
	assert.equal(requests[1].searchParams.get("version"), "7");
	assert.equal(requests[1].searchParams.get("commit"), "selected-commit");
	assert.equal(requests[1].searchParams.get("repositoryId"), "other-repository");
	assert.equal(requests[1].searchParams.get("base"), "base-sha");
	const dependency = head.with({ scheme: REVIEW_LANGUAGE_SOURCE_SCHEME, path: "/prepared/node_modules/lib/index.d.ts" });
	assert.equal(await resolver.resolveEditor({ resource: dependency }, undefined), ResolvedStatus.ABORT);
	assert.deepEqual(windows[2].openables[1], { fileUri: URI.file(dependency.path) });
	assert.equal(requests[2].searchParams.has("file"), false);
	assert.equal(await resolver.resolveEditor({ original: { resource: base }, modified: { resource: head } }, undefined), ResolvedStatus.ABORT);
	assert.deepEqual(windows[3].openables, [
		{ workspaceUri: URI.file("/navigator/head.code-workspace") },
		{ fileUri: URI.file("/navigator/base/old-name.ts") },
		{ fileUri: URI.file("/navigator/head/nested/source.ts") },
	]);
	assert.equal(windows[3].options.diffMode, true);
	const empty = apiSourceUri({ view, side: "base", file: "added.ts" }, true);
	await resolver.resolveEditor({ original: { resource: empty }, modified: { resource: head } }, undefined);
	assert.equal(requests[5].searchParams.get("empty"), "true");
	state.fail = true;
	await assert.rejects(resolver.resolveEditor({ resource: head }, undefined), /Checkout unavailable/);
	assert.equal(windows.length, 5);
	const stock = t.mock.method(EditorResolverService.prototype, "resolveEditor", async () => ResolvedStatus.NONE);
	const settings = { resource: URI.parse("vscode-settings:/settings") };
	assert.equal(await resolver.resolveEditor(settings, undefined), ResolvedStatus.NONE);
	assert.equal(stock.mock.calls[0].arguments[0], settings);
});

test("source files, pinned revisions included, open in the chosen editor; diffs and add/delete placeholders stay in Whiteboard", async (t) => {
	const { resolver, windows, external } = sourceResolver(t, { openFilesIn: "cursor" });
	const view = { reviewId: "review-a", version: 7 };
	const head = apiSourceUri({ view, side: "head", file: "nested/my source.ts" });
	const base = apiSourceUri({ view, side: "base", file: "nested/my source.ts" });
	const dependency = head.with({ scheme: REVIEW_LANGUAGE_SOURCE_SCHEME, path: "/prepared/node_modules/lib/index.d.ts" });
	assert.equal(await resolver.resolveEditor({ resource: head, options: { selection: { startLineNumber: 42, startColumn: 3 } } }, undefined), ResolvedStatus.ABORT);
	await resolver.resolveEditor({ resource: base }, undefined);
	await resolver.resolveEditor({ resource: dependency }, undefined);
	assert.deepEqual(external, [
		{ editor: "cursor", filePath: "/navigator/head/nested/my source.ts", line: 42, column: 3, folder: "/navigator/head" },
		{ editor: "cursor", filePath: "/navigator/base/nested/my source.ts", line: undefined, column: undefined, folder: "/navigator/base" },
		{ editor: "cursor", filePath: "/prepared/node_modules/lib/index.d.ts", line: undefined, column: undefined, folder: "/navigator/head" },
	]);
	assert.equal(windows.length, 0);
	await resolver.resolveEditor({ original: { resource: base }, modified: { resource: head } }, undefined);
	await resolver.resolveEditor({ resource: apiSourceUri({ view, side: "head", file: "added.ts" }, true) }, undefined);
	assert.equal(external.length, 3);
	assert.equal(windows.length, 2);
});

test("a picked application gets the file without a line; with none picked it stays in Whiteboard", async (t) => {
	const view = { reviewId: "review-a", version: 7 };
	const head = apiSourceUri({ view, side: "head", file: "src/a.ts" });
	const selection = { selection: { startLineNumber: 9, startColumn: 1 } };

	const picked = sourceResolver(t, { openFilesIn: "application", application: "/Applications/TextEdit.app" });
	await picked.resolver.resolveEditor({ resource: head, options: selection }, undefined);
	assert.deepEqual(picked.external, [{ application: "/Applications/TextEdit.app", filePath: "/navigator/head/src/a.ts" }]);
	assert.equal(picked.windows.length, 0);

	const unset = sourceResolver(t, { openFilesIn: "application" });
	await unset.resolver.resolveEditor({ resource: head, options: selection }, undefined);
	assert.equal(unset.external.length, 0);
	assert.equal(unset.windows.length, 1);
});
