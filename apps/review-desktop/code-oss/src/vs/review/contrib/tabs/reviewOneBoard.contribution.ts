/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { timeout } from '../../../base/common/async.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IContextKeyService, RawContextKey } from '../../../platform/contextkey/common/contextkey.js';
import type { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { type IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../workbench/common/contributions.js';
import { EditorsOrder } from '../../../workbench/common/editor.js';
import type { EditorInput } from '../../../workbench/common/editor/editorInput.js';
import { IEditorGroupsService } from '../../../workbench/services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../workbench/services/editor/common/editorService.js';
import { ILifecycleService } from '../../../workbench/services/lifecycle/common/lifecycle.js';
import { ReviewCanvasEditorInput } from '../../browser/parts/canvas/reviewCanvasEditorInput.js';
import { REVIEW_BOARDS_FLUSH_EVENT } from '../../common/reviewProtocol.js';
import { IReviewApiCatalogService } from '../../services/reviewApiCatalogService.js';
import { IReviewCanvasEditorTabsService } from '../../services/reviewCanvasEditorTabsService.js';
import { boardsToClose, keepOneGroup, letGoOfUntitled } from './reviewOneBoard.js';
import { RecentCycle, recentBoardIds } from './reviewRecentBoards.js';
import { REVIEW_BOARD_ACTIVE, REVIEW_OPEN_RECENT_BOARD, REVIEW_OPEN_RECENT_BOARD_BACK } from './reviewWindowKeys.js';

/**
 * The window has no tab strip: it shows one board at a time. The boards
 * before it stay open behind hidden tabs, as pages do in a browser's
 * history, so back and forward return to them; the oldest close past a
 * limit. Home stays open behind its own hidden tab.
 */

function boardOf(editor: EditorInput | undefined): string | undefined {
	return editor instanceof ReviewCanvasEditorInput && editor.target.kind === 'api' ? editor.target.reviewId : undefined;
}

class ReviewOneBoard extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.devfast.reviewOneBoard';

	constructor(
		@IEditorService editors: IEditorService,
		@IEditorGroupsService groups: IEditorGroupsService,
		@IReviewApiCatalogService catalog: IReviewApiCatalogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILifecycleService lifecycle: ILifecycleService,
	) {
		super();
		const boardActive = new RawContextKey<boolean>(REVIEW_BOARD_ACTIVE, false).bindTo(contextKeyService);
		// A new board the person has not named yet.
		const untitled = (editor: EditorInput) => catalog.reviews.find((review) => review.reviewId === boardOf(editor))?.title === "";

		// One board at a time: a split, or a layout restored from before,
		// merges back into one group.
		keepOneGroup(groups);
		this._register(groups.onDidAddGroup(() => keepOneGroup(groups)));

		boardActive.set(boardOf(editors.activeEditor ?? undefined) !== undefined);
		this._register(editors.onDidActiveEditorChange(() => {
			const pane = editors.activeEditorPane;
			boardActive.set(boardOf(pane?.input) !== undefined);
			if (!pane) return;
			const behind = pane.group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).filter((editor) => boardOf(editor) && editor !== pane.input);
			const closing = boardsToClose(behind, untitled);
			if (closing.length) void pane.group.closeEditors(closing, { preserveFocus: true });
		}));

		// Closing the window closes no editor. Every open board saves what is
		// typed first, waited for up to ten seconds; then it lets go of its
		// new boards itself: each is released, then is discarded if nobody
		// wrote on it.
		this._register(lifecycle.onBeforeShutdown((event) => {
			const saves: Promise<unknown>[] = [];
			mainWindow.dispatchEvent(new CustomEvent(REVIEW_BOARDS_FLUSH_EVENT, { detail: { waitFor: (saved: Promise<unknown>) => saves.push(saved) } }));
			const saved = saves.length ? Promise.race([Promise.allSettled(saves), timeout(10_000)]) : Promise.resolve();
			const open = groups.groups.flatMap((group) => group.getEditors(EditorsOrder.SEQUENTIAL).filter(untitled).map((editor) => ({ group, editor })));
			if (!open.length && !saves.length) return;
			event.veto(saved.then(() => open.length ? letGoOfUntitled(
				open.map(({ editor }) => boardOf(editor)!),
				() => Promise.all(open.map(({ group, editor }) => group.closeEditor(editor, { preserveFocus: true }))),
				(reviewId) => catalog.discardReview(reviewId),
			) : undefined).then(() => false), 'review.letGoOfBoards');
		}));
	}
}

registerWorkbenchContribution2(ReviewOneBoard.ID, ReviewOneBoard, WorkbenchPhase.AfterRestored);

const cycle = new RecentCycle();

for (const [id, title, direction] of [
	[REVIEW_OPEN_RECENT_BOARD, localize2('review.openRecentBoard', "Open Previous Recent Whiteboard"), 1],
	[REVIEW_OPEN_RECENT_BOARD_BACK, localize2('review.openRecentBoardBack', "Open Next Recent Whiteboard"), -1],
] as const) {
	registerAction2(class extends Action2 {
		constructor() {
			super({ id, title, f1: true });
		}

		override async run(accessor: ServicesAccessor): Promise<void> {
			const catalog = accessor.get(IReviewApiCatalogService);
			const current = boardOf(accessor.get(IEditorService).activeEditor ?? undefined);
			const next = cycle.step(current, () => recentBoardIds(catalog.reviews, current), direction);
			const board = next && catalog.reviews.find((review) => review.reviewId === next);
			if (board) await accessor.get(IReviewCanvasEditorTabsService).openApiReview(board.reviewId, board.title);
		}
	});
}
