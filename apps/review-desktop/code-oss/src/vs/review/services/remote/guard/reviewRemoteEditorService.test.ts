import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../../base/common/uri.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IVisibleEditorPane } from "../../../../workbench/common/editor.js";
import type { IEditorGroup, IEditorGroupsService } from "../../../../workbench/services/editor/common/editorGroupsService.js";
import type { IEditorService } from "../../../../workbench/services/editor/common/editorService.js";
import { editorGroupToColumn } from "../../../../workbench/services/editor/common/editorGroupColumn.js";
import { reviewRemoteEditorGroupsService } from "./reviewRemoteEditorGroupsService.js";
import { reviewRemoteEditorService } from "./reviewRemoteEditorService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const own = URI.parse(`vscode-remote://${A}/home/dev/proj/a.ts`);

function setup() {
	const warnings: string[] = [];
	const calls: string[] = [];
	const group = { id: 3, editors: [] } as unknown as IEditorGroup;
	const windowGroups = { getGroups: () => [group], getGroup: () => group } as unknown as IEditorGroupsService;
	const pane = { group, getControl: () => "control" } as unknown as IVisibleEditorPane;
	const base = {
		openEditor: async (editor: { resource: URI }) => { calls.push(`open ${editor.resource}`); return pane; },
		saveAll: async () => calls.push("saveAll"),
		save: async () => calls.push("save"),
		visibleEditorPanes: [pane],
	} as unknown as IEditorService;
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	const groups = reviewRemoteEditorGroupsService(windowGroups, refusals);
	return { editors: reviewRemoteEditorService(base, groups, refusals), groups, calls, warnings };
}

test("a host opens an editor on its own file, and its panes sit in the guarded groups", async () => {
	const { editors, groups, calls } = setup();
	await editors.openEditor({ resource: own });
	assert.deepEqual(calls, [`open ${own}`]);
	const [pane] = editors.visibleEditorPanes;
	assert.equal(pane.group, groups.getGroup(3));
	assert.equal(pane.getControl(), "control");
	assert.equal(editorGroupToColumn(groups, pane.group), 0);
});

test("laptop, untitled and other hosts' editors, and every save, are refused; each kind logged once", async () => {
	const { editors, calls, warnings } = setup();
	for (const resource of [URI.file("/etc/hosts"), URI.parse("untitled:Untitled-1"), URI.parse("vscode-remote://whiteboard+bbbb-2222/a.ts")]) {
		await assert.rejects(editors.openEditor({ resource }), /^Error: Not available for an extension on wb-test-a: opening editors outside this remote\.$/);
	}
	await assert.rejects(editors.openEditor({ original: { resource: own }, modified: { resource: own } }), /opening editors outside this remote/);
	assert.throws(() => editors.saveAll(), /saving or changing files/);
	assert.throws(() => editors.save([]), /saving or changing files/);
	assert.deepEqual(calls, []);
	assert.deepEqual(warnings, [
		`[Remote guard] ${A}: refused opening editors outside this remote`,
		`[Remote guard] ${A}: refused saving or changing files`,
	]);
});
