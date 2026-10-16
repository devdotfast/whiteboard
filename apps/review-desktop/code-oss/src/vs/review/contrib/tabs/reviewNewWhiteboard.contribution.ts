/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from "../../../base/common/keyCodes.js";
import { Disposable } from "../../../base/common/lifecycle.js";
import { localize, localize2 } from "../../../nls.js";
import { Action2, registerAction2 } from "../../../platform/actions/common/actions.js";
import type { ServicesAccessor } from "../../../platform/instantiation/common/instantiation.js";
import { EditorContextKeys } from "../../../editor/common/editorContextKeys.js";
import { KeybindingWeight } from "../../../platform/keybinding/common/keybindingsRegistry.js";
import { ILogService } from "../../../platform/log/common/log.js";
import { INotificationService } from "../../../platform/notification/common/notification.js";
import { type IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from "../../../workbench/common/contributions.js";
import { EditorCloseContext, EditorsOrder } from "../../../workbench/common/editor.js";
import type { EditorInput } from "../../../workbench/common/editor/editorInput.js";
import { IEditorService } from "../../../workbench/services/editor/common/editorService.js";
import { ReviewCanvasEditorInput } from "../../browser/parts/canvas/reviewCanvasEditorInput.js";
import { newWhiteboardRepositoryPath, REVIEW_NEW_WHITEBOARD_COMMAND_ID } from "../../common/reviewNewWhiteboard.js";
import { IReviewApiCatalogService } from "../../services/reviewApiCatalogService.js";
import { IReviewCanvasEditorTabsService } from "../../services/reviewCanvasEditorTabsService.js";

/** The board in a tab, when the tab is a board. */
function boardOf(editor: EditorInput | undefined): string | undefined {
	return editor instanceof ReviewCanvasEditorInput && editor.target.kind === "api" ? editor.target.reviewId : undefined;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: REVIEW_NEW_WHITEBOARD_COMMAND_ID,
			title: localize2("review.newWhiteboard", "New Whiteboard"),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyN,
				// In a code editor, ⌘N stays New Text File.
				when: EditorContextKeys.editorTextFocus.toNegated(),
				// Above upstream's New Untitled Text File on the same chord.
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const catalog = accessor.get(IReviewApiCatalogService);
		const editors = accessor.get(IEditorService);
		const tabs = accessor.get(IReviewCanvasEditorTabsService);
		const notifications = accessor.get(INotificationService);
		try {
			await catalog.initialize();
			// The active board first, then the boards open most recently.
			const recent = editors.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).map(({ editor }) => boardOf(editor)).filter((id) => id !== undefined);
			const repositoryPath = newWhiteboardRepositoryPath(catalog.reviews, recent);
			if (!repositoryPath) {
				notifications.info(localize("review.newWhiteboard.noProject", "Open a whiteboard in a project to start a new one there."));
				return;
			}
			const reviewId = await catalog.createReview(repositoryPath);
			// Unnamed: the tab reads "Untitled" until a title is typed.
			await tabs.openApiReview(reviewId, "");
		} catch (error) {
			notifications.error(localize("review.newWhiteboard.failed", "Could not start a new whiteboard: {0}", error instanceof Error ? error.message : String(error)));
		}
	}
});

/**
 * Closing a board's last tab discards it when it is still untouched and
 * unnamed: the server checks and deletes, and the catalog drops it.
 */
class ReviewDiscardUntitled extends Disposable implements IWorkbenchContribution {
	static readonly ID = "workbench.contrib.devfast.reviewDiscardUntitled";

	constructor(
		@IEditorService editors: IEditorService,
		@IReviewApiCatalogService catalog: IReviewApiCatalogService,
		@ILogService log: ILogService,
	) {
		super();
		this._register(editors.onDidCloseEditor(({ editor, context }) => {
			const reviewId = boardOf(editor);
			// A board the catalog has not listed yet may be one just created.
			const title = catalog.reviews.find((review) => review.reviewId === reviewId)?.title;
			if (!reviewId || context === EditorCloseContext.MOVE || (title !== undefined && title !== "")) return;
			// Another tab still shows it.
			if (editors.getEditors(EditorsOrder.SEQUENTIAL).some(({ editor }) => boardOf(editor) === reviewId)) return;
			// The server waits for the closing canvas to save and let go of the
			// board, and keeps it while any other canvas still has it open.
			void catalog.discardReview(reviewId).catch((error) => log.trace("[Whiteboard] Could not discard an untitled board:", error));
		}));
	}
}

registerWorkbenchContribution2(ReviewDiscardUntitled.ID, ReviewDiscardUntitled, WorkbenchPhase.AfterRestored);
