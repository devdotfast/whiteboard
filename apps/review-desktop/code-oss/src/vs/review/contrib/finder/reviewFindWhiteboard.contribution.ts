/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from "../../../base/browser/dom.js";
import { KeyCode, KeyMod } from "../../../base/common/keyCodes.js";
import { Disposable, DisposableStore, toDisposable } from "../../../base/common/lifecycle.js";
import { localize2 } from "../../../nls.js";
import { Action2, registerAction2 } from "../../../platform/actions/common/actions.js";
import { InstantiationType, registerSingleton } from "../../../platform/instantiation/common/extensions.js";
import { type ServicesAccessor, createDecorator } from "../../../platform/instantiation/common/instantiation.js";
import { KeybindingWeight } from "../../../platform/keybinding/common/keybindingsRegistry.js";
import { ILogService } from "../../../platform/log/common/log.js";
import { IEditorService } from "../../../workbench/services/editor/common/editorService.js";
import { IWorkbenchLayoutService } from "../../../workbench/services/layout/browser/layoutService.js";
import { loadReviewCanvasAssets } from "../../browser/parts/canvas/reviewCanvasAssets.js";
import { boardOf } from "../../browser/parts/canvas/reviewCanvasEditorInput.js";
import { REVIEW_FIND_WHITEBOARD_COMMAND_ID } from "../../common/reviewFindWhiteboard.js";
import type { ReviewFinderProps } from "../../common/reviewProtocol.js";
import { IReviewApiCatalogService } from "../../services/reviewApiCatalogService.js";
import { IReviewCanvasEditorTabsService } from "../../services/reviewCanvasEditorTabsService.js";
import { IReviewTelemetryService } from "../../services/reviewTelemetryService.js";

export const IReviewFinderService = createDecorator<IReviewFinderService>("reviewFinderService");

export interface IReviewFinderService {
	readonly _serviceBrand: undefined;
	/** Shows the finder over the window, or closes it when it is up. */
	toggle(): Promise<void>;
}

/** The finder (⌘K): the canvas bundle's search over the catalog, mounted
 * in the workbench container while it is up. */
class ReviewFinderService extends Disposable implements IReviewFinderService {
	declare readonly _serviceBrand: undefined;
	private shown: DisposableStore | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IEditorService private readonly editorService: IEditorService,
		@IReviewApiCatalogService private readonly catalog: IReviewApiCatalogService,
		@IReviewCanvasEditorTabsService private readonly tabs: IReviewCanvasEditorTabsService,
		@IReviewTelemetryService private readonly telemetry: IReviewTelemetryService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async toggle(): Promise<void> {
		if (this.shown) {
			this.close();
			return;
		}
		const [assets] = await Promise.all([
			loadReviewCanvasAssets(),
			this.catalog.initialize().catch((error) => this.logService.warn("[Whiteboard] Finder catalog failed:", error)),
		]);
		// A second press while loading, or a window on its way out.
		if (this.shown || this._store.isDisposed) return;
		const container = $(".review-finder");
		this.layoutService.mainContainer.appendChild(container);
		const shown = new DisposableStore();
		const handle = assets.mountReviewFinder(container, this.props());
		shown.add(toDisposable(() => {
			handle.dispose();
			container.remove();
		}));
		shown.add(this.catalog.onDidChange(() => handle.update(this.props())));
		this.shown = shown;
	}

	private props(): ReviewFinderProps {
		const current = boardOf(this.editorService.activeEditor);
		return {
			boards: this.catalog.reviews.filter((review) => !review.trashedAt),
			...(current && { current }),
			onOpen: (reviewId) => {
				const title = this.catalog.reviews.find((review) => review.reviewId === reviewId)?.title ?? "Whiteboard";
				this.close();
				this.telemetry.capture("review_opened", { via: "finder" });
				void this.tabs.openApiReview(reviewId, title);
			},
			onClose: () => this.close(),
		};
	}

	private close(): void {
		this.shown?.dispose();
		this.shown = undefined;
	}

	override dispose(): void {
		this.close();
		super.dispose();
	}
}

registerSingleton(IReviewFinderService, ReviewFinderService, InstantiationType.Delayed);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: REVIEW_FIND_WHITEBOARD_COMMAND_ID,
			title: localize2("review.findWhiteboard", "Find Whiteboard"),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyK,
				// Over upstream's ⌘K chords; the theme picker keeps its menu entry.
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IReviewFinderService).toggle();
	}
});
