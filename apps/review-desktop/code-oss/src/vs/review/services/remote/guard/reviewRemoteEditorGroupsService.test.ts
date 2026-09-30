import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { EditorInput } from "../../../../workbench/common/editor/editorInput.js";
import { GroupsOrder, type IEditorGroup, type IEditorGroupsService } from "../../../../workbench/services/editor/common/editorGroupsService.js";
import { reviewRemoteEditorGroupsService } from "./reviewRemoteEditorGroupsService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const refused = /^Error: Not available for an extension on wb-test-a: changing the window's editors\.$/;

function editorGroupsFixture() {
	const laptop = { resource: URI.file("/Users/me/secret-notes.md") } as unknown as EditorInput;
	const review = { resource: undefined } as unknown as EditorInput;
	const own = { resource: URI.parse(`vscode-remote://${A}/home/dev/proj/a.ts`) } as unknown as EditorInput;
	const calls: string[] = [];
	const group = {
		id: 7,
		editors: [laptop, review, own],
		activeEditor: laptop,
		isSticky: () => false,
		closeEditor: async (editor: EditorInput) => calls.push(`close ${editor.resource}`),
		closeAllEditors: async () => calls.push("closeAll"),
	} as unknown as IEditorGroup;
	const added = new Emitter<IEditorGroup>();
	const base = {
		groups: [group],
		activeGroup: group,
		getGroups: () => [group],
		getGroup: (id: number) => (id === 7 ? group : undefined),
		addGroup: () => calls.push("addGroup"),
		removeGroup: () => calls.push("removeGroup"),
		onDidAddGroup: added.event,
	} as unknown as IEditorGroupsService;
	return { base, group, laptop, own, calls, added };
}

function setup() {
	const warnings: string[] = [];
	const fixture = editorGroupsFixture();
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	return { ...fixture, groups: reviewRemoteEditorGroupsService(fixture.base, refusals), warnings };
}

test("a host sees the window's groups with only its own editors in them", () => {
	const { groups, own, added, group } = setup();
	const [guarded] = groups.groups;
	assert.deepEqual(guarded.editors, [own]);
	assert.equal(guarded.count, 1);
	assert.equal(guarded.activeEditor, null);
	assert.equal(guarded.id, 7);
	assert.equal(groups.activeGroup, guarded);
	assert.equal(groups.getGroup(7), guarded);
	assert.equal(groups.getGroups(GroupsOrder.GRID_APPEARANCE).indexOf(guarded), 0);
	const seen: IEditorGroup[] = [];
	groups.onDidAddGroup((g) => seen.push(g));
	added.fire(group);
	assert.equal(seen[0], guarded);
});

test("a host closes its own editors only and changes no layout, logged once", async () => {
	const { groups, own, laptop, calls, warnings } = setup();
	const [guarded] = groups.groups;
	await guarded.closeEditor(own);
	await assert.rejects(guarded.closeEditor(laptop), refused);
	assert.throws(() => guarded.closeAllEditors(), refused);
	assert.throws(() => groups.addGroup(guarded, 3), refused);
	assert.throws(() => groups.removeGroup(guarded), refused);
	assert.deepEqual(calls, [`close ${own.resource}`]);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused changing the window's editors`]);
});
