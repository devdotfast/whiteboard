/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import type { IVisibleEditorPane } from "../../../../workbench/common/editor.js";
import type { IEditorGroupsService } from "../../../../workbench/services/editor/common/editorGroupsService.js";
import type { IEditorService } from "../../../../workbench/services/editor/common/editorService.js";
import { override, type ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

/**
 * A host opens editors on its own files only, and saves, reverts or closes
 * none: `workspace.saveAll` would otherwise save every dirty laptop editor.
 * Its panes' groups are the guarded ones, so it sees only its own editors.
 * Tab changes do not reach it; the tab peer sees whole rebuilds only.
 */
export function reviewRemoteEditorService(base: IEditorService, groups: IEditorGroupsService, refusals: ReviewRemoteRefusals): IEditorService {
	const pane = (editorPane: IVisibleEditorPane) => override(editorPane, {
		get group() { return groups.getGroup(editorPane.group.id) ?? editorPane.group; },
	});
	return override(base, {
		...refusals.refuseAll<IEditorService>(["openEditors", "replaceEditors", "closeEditor", "closeEditors", "createScoped"], "changing the window's editors"),
		...refusals.refuseAll<IEditorService>(["save", "saveAll", "revert", "revertAll"], "saving or changing files"),
		openEditor: (async (editor: { resource?: unknown }, ...rest: unknown[]) => {
			if (!URI.isUri(editor.resource) || !refusals.owns(editor.resource)) throw refusals.refuse("opening editors outside this remote");
			return (base.openEditor as (...args: unknown[]) => unknown)(editor, ...rest);
		}) as IEditorService["openEditor"],
		get visibleEditorPanes() { return base.visibleEditorPanes.map(pane); },
		get activeEditorPane() {
			const active = base.activeEditorPane;
			return active && pane(active);
		},
		onDidEditorsChange: Event.None,
	});
}
