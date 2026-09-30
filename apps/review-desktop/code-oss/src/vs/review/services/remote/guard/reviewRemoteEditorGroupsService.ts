/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import type { EditorInput } from "../../../../workbench/common/editor/editorInput.js";
import type { IEditorGroup, IEditorGroupsService } from "../../../../workbench/services/editor/common/editorGroupsService.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const LAYOUT = "changing the window's editors";

/**
 * A host sees the window's editor groups with only its own editors in them,
 * so the tabs the laptop has open are not sent to it, and it cannot close,
 * move or open the laptop's editors or change the layout.
 */
export function reviewRemoteEditorGroupsService(base: IEditorGroupsService, refusals: ReviewRemoteRefusals): IEditorGroupsService {
	const own = (editor: EditorInput | null | undefined): editor is EditorInput => URI.isUri(editor?.resource) && refusals.owns(editor.resource);
	const guarded = new WeakMap<IEditorGroup, IEditorGroup>();
	const guard = (group: IEditorGroup): IEditorGroup => {
		let result = guarded.get(group);
		if (!result) {
			const editors = () => group.editors.filter(own);
			result = override<IEditorGroup>(group, {
				...refusals.refuseAll<IEditorGroup>(
					["closeEditors", "closeAllEditors", "moveEditor", "moveEditors", "copyEditor", "copyEditors", "openEditor", "openEditors", "pinEditor", "stickEditor", "unstickEditor", "lock", "replaceEditors", "setSelection"],
					LAYOUT,
				),
				get editors() { return editors(); },
				get count() { return editors().length; },
				get isEmpty() { return editors().length === 0; },
				get stickyCount() { return editors().filter((editor) => group.isSticky(editor)).length; },
				get activeEditor() { return own(group.activeEditor) ? group.activeEditor : null; },
				get previewEditor() { return own(group.previewEditor) ? group.previewEditor : null; },
				get selectedEditors() { return group.selectedEditors.filter(own); },
				getEditors: (order, options) => group.getEditors(order, options).filter(own),
				getEditorByIndex: (index) => editors()[index],
				getIndexOfEditor: (editor) => editors().indexOf(editor),
				findEditors: (resource, options) => (refusals.owns(resource) ? group.findEditors(resource, options) : []),
				closeEditor: async (editor, options) => {
					if (!own(editor)) throw refusals.refuse(LAYOUT);
					return group.closeEditor(editor, options);
				},
				onDidModelChange: Event.None,
				onWillCloseEditor: Event.None,
				onDidCloseEditor: Event.None,
				onWillMoveEditor: Event.None,
				onDidActiveEditorChange: Event.None,
			});
			guarded.set(group, result);
		}
		return result;
	};
	return override(base, {
		...refusals.refuseAll<IEditorGroupsService>(
			["addGroup", "removeGroup", "moveGroup", "mergeGroup", "mergeAllGroups", "copyGroup", "activateGroup", "applyLayout", "arrangeGroups", "setSize", "setGroupOrientation", "toggleMaximizeGroup", "toggleExpandGroup", "applyWorkingSet", "saveWorkingSet", "deleteWorkingSet", "createAuxiliaryEditorPart", "createModalEditorPart", "enforcePartOptions", "getPart"],
			LAYOUT,
		),
		get groups() { return base.groups.map(guard); },
		get activeGroup() { return guard(base.activeGroup); },
		get sideGroup() { return { openEditor: () => { throw refusals.refuse(LAYOUT); } }; },
		getGroups: (order) => base.getGroups(order).map(guard),
		getGroup: (id) => {
			const group = base.getGroup(id);
			return group && guard(group);
		},
		findGroup: (scope, source, wrap) => {
			const group = base.findGroup(scope, source, wrap);
			return group && guard(group);
		},
		onDidAddGroup: Event.map(base.onDidAddGroup, guard),
		onDidRemoveGroup: Event.map(base.onDidRemoveGroup, guard),
		onDidMoveGroup: Event.map(base.onDidMoveGroup, guard),
		onDidChangeActiveGroup: Event.map(base.onDidChangeActiveGroup, guard),
		onDidChangeGroupIndex: Event.map(base.onDidChangeGroupIndex, guard),
		onDidChangeGroupLocked: Event.map(base.onDidChangeGroupLocked, guard),
		onDidActivateGroup: Event.map(base.onDidActivateGroup, (e) => ({ ...e, group: guard(e.group) })),
	});
}
