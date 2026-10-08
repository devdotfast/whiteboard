/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IContextKeyService, RawContextKey } from '../../../platform/contextkey/common/contextkey.js';
import type { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { type IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../workbench/common/contributions.js';
import type { EditorInput } from '../../../workbench/common/editor/editorInput.js';
import { IEditorService } from '../../../workbench/services/editor/common/editorService.js';
import { IWorkbenchLayoutService } from '../../../workbench/services/layout/browser/layoutService.js';
import { ReviewCanvasEditorInput } from '../../browser/parts/canvas/reviewCanvasEditorInput.js';
import { IReviewCanvasEditorTabsService } from '../../services/reviewCanvasEditorTabsService.js';

/**
 * Home is a window control, not a tab. Its editor stays open with a hidden
 * tab, so back and forward still go through it.
 */

const REVIEW_HOME_ACTIVE = new RawContextKey<boolean>('reviewHomeActive', false);

/** Set on the workbench while Home shows: the house is lit. */
const REVIEW_HOME_ACTIVE_CLASS = 'review-home-active';

function isReviewHome(editor: EditorInput | undefined): boolean {
	return editor instanceof ReviewCanvasEditorInput && editor.target.kind === 'home';
}

class ReviewHomeContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.devfast.reviewHome';

	constructor(
		@IEditorService editorService: IEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
	) {
		super();
		const homeActive = REVIEW_HOME_ACTIVE.bindTo(contextKeyService);
		const update = () => {
			const active = isReviewHome(editorService.activeEditor);
			homeActive.set(active);
			layoutService.mainContainer.classList.toggle(REVIEW_HOME_ACTIVE_CLASS, active);
		};
		update();
		this._register(editorService.onDidActiveEditorChange(update));
	}
}

registerWorkbenchContribution2(ReviewHomeContribution.ID, ReviewHomeContribution, WorkbenchPhase.AfterRestored);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'review.openHome',
			title: localize2('review.openHome', "Go Home"),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
				// Above upstream's Replace in Files on the same chord.
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IReviewCanvasEditorTabsService).openHome(true);
	}
});

// On Home, closing the tab closes the window, as a browser does with its
// last tab; macOS keeps the app running.
KeybindingsRegistry.registerKeybindingRule({
	id: 'workbench.action.closeWindow',
	when: REVIEW_HOME_ACTIVE,
	primary: KeyMod.CtrlCmd | KeyCode.KeyW,
	weight: KeybindingWeight.WorkbenchContrib + 1,
});
