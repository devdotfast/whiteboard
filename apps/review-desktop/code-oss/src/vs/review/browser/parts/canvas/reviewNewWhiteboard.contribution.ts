/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from "../../../../base/common/keyCodes.js";
import { localize2 } from "../../../../nls.js";
import { Action2, registerAction2 } from "../../../../platform/actions/common/actions.js";
import { ICommandService } from "../../../../platform/commands/common/commands.js";
import type { ServicesAccessor } from "../../../../platform/instantiation/common/instantiation.js";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingsRegistry.js";
import { ActiveEditorContext } from "../../../../workbench/common/contextkeys.js";
import { NEW_UNTITLED_FILE_COMMAND_ID } from "../../../../workbench/contrib/files/browser/fileConstants.js";
import { IEditorService } from "../../../../workbench/services/editor/common/editorService.js";
import { ReviewCanvasEditorInput } from "./reviewCanvasEditorInput.js";
import { ReviewCanvasEditorPane } from "./reviewCanvasPart.js";

/** ⌘N on Home opens New whiteboard; anywhere else it stays New Untitled File. */
class ReviewNewWhiteboardAction extends Action2 {
	constructor() {
		super({
			id: "review.action.newWhiteboard",
			title: localize2("review.action.newWhiteboard", "New Whiteboard"),
			keybinding: {
				// Above the workbench's New Untitled File, which also takes ⌘N.
				weight: KeybindingWeight.WorkbenchContrib + 1,
				primary: KeyMod.CtrlCmd | KeyCode.KeyN,
				when: ActiveEditorContext.isEqualTo(ReviewCanvasEditorInput.EDITOR_ID),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const pane = accessor.get(IEditorService).activeEditorPane;
		if (pane instanceof ReviewCanvasEditorPane && pane.newWhiteboard()) return;
		await accessor.get(ICommandService).executeCommand(NEW_UNTITLED_FILE_COMMAND_ID);
	}
}

registerAction2(ReviewNewWhiteboardAction);
