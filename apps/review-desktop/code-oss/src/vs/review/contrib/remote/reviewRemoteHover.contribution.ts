/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from "../../../base/common/lifecycle.js";
import { type ICodeEditor, MouseTargetType } from "../../../editor/browser/editorBrowser.js";
import { ICodeEditorService } from "../../../editor/browser/services/codeEditorService.js";
import type { Position } from "../../../editor/common/core/position.js";
import { Range } from "../../../editor/common/core/range.js";
import { ContentHoverController } from "../../../editor/contrib/hover/browser/contentHoverController.js";
import { HoverStartMode, HoverStartSource } from "../../../editor/contrib/hover/browser/hoverOperation.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../../workbench/common/contributions.js";
import { IReviewRemoteHostsService } from "../../services/remote/reviewRemoteHosts.js";

const MAX_REFRESHES = 3;

/** When a remote host's language work stops, a hover under the pointer asks again. */
class ReviewRemoteHoverRefresh extends Disposable {
	static readonly ID = "review.remoteHoverRefresh";

	private readonly pointers = new Map<ICodeEditor, Position>();
	// A refreshed hover can start more work; a few refreshes per position end that loop.
	private readonly refreshes = new Map<ICodeEditor, number>();
	private readonly editors = this._register(new DisposableMap<ICodeEditor>());

	constructor(
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IReviewRemoteHostsService hosts: IReviewRemoteHostsService,
	) {
		super();
		for (const editor of codeEditorService.listCodeEditors()) this.track(editor);
		this._register(codeEditorService.onCodeEditorAdd((editor) => this.track(editor)));
		this._register(codeEditorService.onCodeEditorRemove((editor) => {
			this.editors.deleteAndDispose(editor);
			this.pointers.delete(editor);
			this.refreshes.delete(editor);
		}));
		this._register(hosts.onDidSettle(() => this.refresh()));
	}

	private track(editor: ICodeEditor): void {
		const store = new DisposableStore();
		store.add(editor.onMouseMove(({ target }) => {
			const position = target.type === MouseTargetType.CONTENT_TEXT ? target.position : null;
			if (!position || !this.pointers.get(editor)?.equals(position)) this.refreshes.delete(editor);
			if (position) this.pointers.set(editor, position);
			else this.pointers.delete(editor);
		}));
		store.add(editor.onMouseLeave(() => {
			this.pointers.delete(editor);
			this.refreshes.delete(editor);
		}));
		this.editors.set(editor, store);
	}

	private refresh(): void {
		for (const [editor, position] of this.pointers) {
			const hover = ContentHoverController.get(editor);
			const count = this.refreshes.get(editor) ?? 0;
			if (!hover?.isHoverVisible || count >= MAX_REFRESHES) continue;
			this.refreshes.set(editor, count + 1);
			hover.hideContentHover();
			hover.showContentHover(Range.fromPositions(position), HoverStartMode.Immediate, HoverStartSource.Mouse, false);
		}
	}
}

registerWorkbenchContribution2(ReviewRemoteHoverRefresh.ID, ReviewRemoteHoverRefresh, WorkbenchPhase.AfterRestored);
