/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createStyleSheet } from "../../../base/browser/domStylesheets.js";
import { Disposable, toDisposable } from "../../../base/common/lifecycle.js";
import { ILogService } from "../../../platform/log/common/log.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../../workbench/common/contributions.js";
import { IEditorService } from "../../../workbench/services/editor/common/editorService.js";
import { IHostService } from "../../../workbench/services/host/browser/host.js";
import { ReviewCanvasEditorInput } from "../../browser/parts/canvas/reviewCanvasEditorInput.js";
import { BOARD_ICONS, boardIconKind, boardIconMarkup, type BoardIconKind } from "../../common/reviewProtocol.js";
import { IReviewApiCatalogService } from "../../services/reviewApiCatalogService.js";
import { IReviewCanvasEditorTabsService } from "../../services/reviewCanvasEditorTabsService.js";

/**
 * Draws each board tab's icon. Marks a board viewed while it is the active
 * tab of a focused window, and badges its tab if it changed while out of
 * view.
 */
class ReviewBoardTabs extends Disposable {
	/** Boards with a view request still in flight. */
	private readonly marking = new Set<string>();

	constructor(
		@IReviewApiCatalogService private readonly catalog: IReviewApiCatalogService,
		@IReviewCanvasEditorTabsService private readonly tabs: IReviewCanvasEditorTabsService,
		@IEditorService private readonly editors: IEditorService,
		@IHostService private readonly host: IHostService,
		@ILogService private readonly log: ILogService,
	) {
		super();
		// The canvas's board icons, as masks for the tab icons in review.css.
		const sheet = createStyleSheet();
		sheet.textContent = (Object.keys(BOARD_ICONS) as BoardIconKind[])
			.map((icon) => `.monaco-workbench .review-board-icon-${icon} { --review-board-icon: url("data:image/svg+xml,${encodeURIComponent(boardIconMarkup(BOARD_ICONS[icon]))}"); }`)
			.join("\n");
		this._register(toDisposable(() => sheet.remove()));
		const update = () => this.update();
		this._register(catalog.onDidChange(update));
		this._register(editors.onDidActiveEditorChange(update));
		this._register(editors.onDidEditorsChange(update));
		this._register(host.onDidChangeFocus(update));
		update();
	}

	private viewing(reviewId: string): boolean {
		return this.host.hasFocus && this.tabs.isActiveReview(reviewId);
	}

	private update(): void {
		for (const review of this.catalog.reviews) {
			if (!review.changed || !this.viewing(review.reviewId) || this.marking.has(review.reviewId)) continue;
			this.marking.add(review.reviewId);
			void this.catalog
				.attention(review.reviewId, "view")
				.catch((error) => this.log.warn("[Whiteboard] Could not mark session viewed:", error))
				.finally(() => this.marking.delete(review.reviewId));
		}

		for (const editor of this.editors.editors) {
			if (!(editor instanceof ReviewCanvasEditorInput) || editor.target.kind !== "api") continue;
			const { reviewId } = editor.target;
			const review = this.catalog.reviews.find((item) => item.reviewId === reviewId);
			editor.setChanged(Boolean(review?.changed) && !this.viewing(reviewId));
			if (review) editor.setBoardIcon(boardIconKind(review.target));
		}
	}
}

registerWorkbenchContribution2("review.boardTabs", ReviewBoardTabs, WorkbenchPhase.AfterRestored);
