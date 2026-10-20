/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from "../../../base/common/lifecycle.js";
import { ILogService } from "../../../platform/log/common/log.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../../workbench/common/contributions.js";
import { IEditorService } from "../../../workbench/services/editor/common/editorService.js";
import { IHostService } from "../../../workbench/services/host/browser/host.js";
import { IReviewApiCatalogService } from "../../services/reviewApiCatalogService.js";
import { IReviewCanvasEditorTabsService } from "../../services/reviewCanvasEditorTabsService.js";

class ReviewBoardTabs extends Disposable {
	/** Boards with a view request still in flight. */
	private readonly marking = new Set<string>();

	constructor(
		@IReviewApiCatalogService private readonly catalog: IReviewApiCatalogService,
		@IReviewCanvasEditorTabsService private readonly tabs: IReviewCanvasEditorTabsService,
		@IEditorService editors: IEditorService,
		@IHostService private readonly host: IHostService,
		@ILogService private readonly log: ILogService,
	) {
		super();
		const update = () => this.update();
		this._register(catalog.onDidChange(update));
		this._register(editors.onDidActiveEditorChange(update));
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
	}
}

registerWorkbenchContribution2("review.boardTabs", ReviewBoardTabs, WorkbenchPhase.AfterRestored);
