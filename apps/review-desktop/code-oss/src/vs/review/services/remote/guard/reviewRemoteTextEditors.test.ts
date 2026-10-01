import assert from "node:assert/strict";
import test from "node:test";
import type { IMarkdownString } from "../../../../base/common/htmlContent.js";
import { URI } from "../../../../base/common/uri.js";
import type { ICodeEditorService } from "../../../../editor/browser/services/codeEditorService.js";
import type { IDecorationOptions, IDecorationRenderOptions } from "../../../../editor/common/editorCommon.js";
import type { IConfigurationService } from "../../../../platform/configuration/common/configuration.js";
import { ExtensionIdentifier } from "../../../../platform/extensions/common/extensions.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IEditorGroupsService } from "../../../../workbench/services/editor/common/editorGroupsService.js";
import type { IEditorService } from "../../../../workbench/services/editor/common/editorService.js";
import type { IExtHostContext } from "../../../../workbench/services/extensions/common/extHostCustomers.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { ReviewRemoteTextEditors } from "./reviewRemoteTextEditors.js";

const A = "whiteboard+aaaa-1111";
const B = "whiteboard+bbbb-2222";
const own = URI.parse(`vscode-remote://${A}/home/dev/proj/a.ts`);
const command = "command:vscode.open?%5B%22file%3A%2F%2F%2Fetc%2Fhosts%22%5D";

/** The window's code editors and its one decoration-type registry. */
function window() {
	const set: { key: string; decorations: IDecorationOptions[] }[] = [];
	const types = new Map<string, IDecorationRenderOptions>();
	const removed: string[] = [];
	const editor = (id: string, uri: URI) => ({
		getId: () => id,
		hasModel: () => true,
		getModel: () => ({ id: `${id}-model`, uri }),
		setDecorationsByType: (_description: string, key: string, decorations: IDecorationOptions[]) => set.push({ key, decorations }),
	});
	const editors = [editor("laptop", URI.file("/Users/me/proj/a.ts")), editor("own", own), editor("b", URI.parse(`vscode-remote://${B}/home/dev/proj/a.ts`))];
	const codeEditors = {
		listCodeEditors: () => editors,
		registerDecorationType: (_description: string, key: string, options: IDecorationRenderOptions) => {
			if (types.has(key)) throw new Error(`${key} registered twice`);
			types.set(key, options);
		},
		removeDecorationType: (key: string) => {
			removed.push(key);
			types.delete(key);
		},
	} as unknown as ICodeEditorService;
	return { set, types, removed, codeEditors };
}

function peer(authority: string, codeEditors: ICodeEditorService) {
	const warnings: string[] = [];
	const refusals = new ReviewRemoteRefusals(authority, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	const editors = new ReviewRemoteTextEditors({} as IExtHostContext, codeEditors, {} as IEditorService, {} as IEditorGroupsService, {} as IConfigurationService, refusals);
	return { editors, warnings };
}

test("a decoration's hover on a remote's own editor reaches the window untrusted, without its command link", async () => {
	const { set, codeEditors } = window();
	const { editors, warnings } = peer(A, codeEditors);
	const hover = (value: string): IMarkdownString => ({ value, isTrusted: true, supportHtml: true, uris: { [command]: URI.parse(command) } });

	await editors.$trySetDecorations("own,own-model", "TextEditorDecorationType1", [
		{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, hoverMessage: hover(`wb probe [open](${command})`) },
		{ range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 }, hoverMessage: [hover(`[x](${command})`), hover("[web](https://ok.example)")] },
	]);

	const [{ decorations }] = set;
	const messages = decorations.flatMap((decoration) => [decoration.hoverMessage ?? []].flat());
	assert.deepEqual(messages.map((message) => message.value), ["wb probe open", "x", "[web](https://ok.example)"]);
	assert.ok(messages.every((message) => message.isTrusted === false && message.supportHtml === false && !("uris" in message)));
	assert.ok(warnings.some((warning) => warning.includes("refused links other than http, https and mailto")));
});

test("a decoration icon outside the remote's own files is dropped, and CSS that fetches or adds rules is too", () => {
	const { types, codeEditors } = window();
	const { editors, warnings } = peer(A, codeEditors);
	const ownIcon = URI.parse(`vscode-remote://${A}/home/dev/icon.svg`);

	editors.$registerTextEditorDecorationType(new ExtensionIdentifier("wb-test.probe"), "TextEditorDecorationType1", {
		gutterIconPath: URI.file("/Users/me/.ssh/id_ed25519"),
		backgroundColor: "red; background-image: url(https://example.com/x.png)",
		color: { id: "editor.foreground" },
		before: { contentText: "wb probe before", contentIconPath: URI.parse("https://example.com/x.png") },
		dark: { after: { contentText: "wb probe after", contentIconPath: ownIcon, color: "blue", textDecoration: "none}.monaco-editor{display:none" } },
	});

	const [[key, options]] = [...types];
	assert.match(key, /^[\w-]+$/, "the key is a CSS class name");
	assert.deepEqual(JSON.parse(JSON.stringify(options)), {
		color: { id: "editor.foreground" },
		before: { contentText: "wb probe before" },
		dark: { after: { contentText: "wb probe after", contentIconPath: JSON.parse(JSON.stringify(ownIcon)), color: "blue" } },
	});
	assert.deepEqual(warnings.map((warning) => warning.replace(/^.*refused /, "")).sort(), ["decoration icons outside this remote", "decoration styles that fetch or add CSS"]);
});

test("two hosts that register the same decoration key get two types, and removing one leaves the other", () => {
	const { types, removed, codeEditors } = window();
	const a = peer(A, codeEditors).editors;
	const b = peer(B, codeEditors).editors;
	a.$registerTextEditorDecorationType(new ExtensionIdentifier("x.y"), "1", { color: "red" });
	b.$registerTextEditorDecorationType(new ExtensionIdentifier("x.y"), "1", { color: "blue" });
	assert.deepEqual([...types.values()].map((options) => options.color), ["red", "blue"]);

	b.$removeTextEditorDecorationType("1");
	b.$removeTextEditorDecorationType("2");
	assert.deepEqual([...types.values()].map((options) => options.color), ["red"]);
	a.dispose();
	assert.equal(types.size, 0);
	assert.equal(removed.length, 2, "nothing the host did not register is removed");
});

test("a remote decorates, selects in and edits no editor but its own, and edits none at all", async () => {
	const { set, codeEditors } = window();
	const { editors } = peer(A, codeEditors);
	const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 };
	for (const id of ["laptop,laptop-model", "b,b-model"]) {
		await assert.rejects(editors.$trySetDecorations(id, "1", [{ range }]), /Illegal argument: TextEditor/);
		await assert.rejects(editors.$trySetSelections(id, []), /Illegal argument: TextEditor/);
	}
	assert.deepEqual(set, []);
	const refused = /^Error: Not available for an extension on wb-test-a: /;
	await assert.rejects(editors.$tryApplyEdits(), refused);
	await assert.rejects(editors.$tryInsertSnippet(), refused);
	await assert.rejects(editors.$trySetOptions(), refused);
	await assert.rejects(editors.$tryHideEditor(), refused);
	await assert.rejects(editors.$getDiffInformation(), refused);
});
