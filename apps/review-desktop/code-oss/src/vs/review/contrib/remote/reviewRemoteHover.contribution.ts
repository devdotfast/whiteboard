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

/** When a remote language server finishes starting, a hover under the pointer asks again. */
class ReviewRemoteHoverRefresh extends Disposable {
	static readonly ID = "review.remoteHoverRefresh";

	private readonly pointers = new Map<ICodeEditor, Position>();
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
		}));
		let busy = hosts.busy;
		this._register(hosts.onDidChangeBusy(() => {
			const was = busy;
			busy = hosts.busy;
			if (was && !busy) this.refresh();
		}));
	}

	private track(editor: ICodeEditor): void {
		const store = new DisposableStore();
		store.add(editor.onMouseMove(({ target }) => {
			if (target.type === MouseTargetType.CONTENT_TEXT && target.position) this.pointers.set(editor, target.position);
			else this.pointers.delete(editor);
		}));
		store.add(editor.onMouseLeave(() => this.pointers.delete(editor)));
		this.editors.set(editor, store);
	}

	private refresh(): void {
		for (const [editor, position] of this.pointers) {
			const hover = ContentHoverController.get(editor);
			if (!hover?.isHoverVisible) continue;
			hover.hideContentHover();
			hover.showContentHover(Range.fromPositions(position), HoverStartMode.Immediate, HoverStartSource.Mouse, false);
		}
	}
}

registerWorkbenchContribution2(ReviewRemoteHoverRefresh.ID, ReviewRemoteHoverRefresh, WorkbenchPhase.AfterRestored);
