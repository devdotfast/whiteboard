/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createStyleSheet } from "../../../base/browser/domStylesheets.js";
import { Disposable, toDisposable } from "../../../base/common/lifecycle.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../../workbench/common/contributions.js";
import { IEditorService } from "../../../workbench/services/editor/common/editorService.js";
import { ReviewCanvasEditorInput } from "../../browser/parts/canvas/reviewCanvasEditorInput.js";
import { BOARD_ICONS, boardIconKind, boardIconMarkup, type BoardIconKind } from "../../common/reviewProtocol.js";
import { IReviewApiCatalogService } from "../../services/reviewApiCatalogService.js";

/** Draws each board tab's icon. */
class ReviewBoardTabs extends Disposable {
	constructor(
		@IReviewApiCatalogService private readonly catalog: IReviewApiCatalogService,
		@IEditorService private readonly editors: IEditorService,
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
		this._register(editors.onDidEditorsChange(update));
		update();
	}

	private update(): void {
		for (const editor of this.editors.editors) {
			if (!(editor instanceof ReviewCanvasEditorInput) || editor.target.kind !== "api") continue;
			const { reviewId } = editor.target;
			const review = this.catalog.reviews.find((item) => item.reviewId === reviewId);
			if (review) editor.setBoardIcon(boardIconKind(review.target));
		}
	}
}

registerWorkbenchContribution2("review.boardTabs", ReviewBoardTabs, WorkbenchPhase.AfterRestored);
