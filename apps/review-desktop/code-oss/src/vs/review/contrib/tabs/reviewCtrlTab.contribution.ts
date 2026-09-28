/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { localize2 } from '../../../nls.js';
import { Action2, registerAction2 } from '../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import type { ServicesAccessor } from '../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { EditorsOrder } from '../../../workbench/common/editor.js';
import { IEditorGroupsService } from '../../../workbench/services/editor/common/editorGroupsService.js';
import { REVIEW_CTRL_TAB_SETTING } from '../../common/reviewConfigurationDefaults.js';

const OPEN_LAST_USED_TAB = 'review.openLastUsedTab';

/**
 * Opens the tab used before the active one. Upstream's instant command walks
 * further back through history on each press; this toggles between two tabs.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({ id: OPEN_LAST_USED_TAB, title: localize2('review.openLastUsedTab', "Open Last Used Tab") });
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const group = accessor.get(IEditorGroupsService).activeGroup;
		const previous = group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)[1];
		if (previous) {
			await group.openEditor(previous);
		}
	}
});

/**
 * Ctrl+Tab follows `review.tabs.ctrlTab` in place of upstream's recent-editors
 * picker, which binds the same chords at `WorkbenchContrib`.
 */
const nextMode = ContextKeyExpr.equals(`config.${REVIEW_CTRL_TAB_SETTING}`, 'next');
const recentMode = ContextKeyExpr.notEquals(`config.${REVIEW_CTRL_TAB_SETTING}`, 'next');
const ctrlTab = { primary: KeyMod.CtrlCmd | KeyCode.Tab, mac: { primary: KeyMod.WinCtrl | KeyCode.Tab } };
const ctrlShiftTab = { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Tab, mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Tab } };

for (const [id, when, keys] of [
	[OPEN_LAST_USED_TAB, recentMode, ctrlTab],
	[OPEN_LAST_USED_TAB, recentMode, ctrlShiftTab],
	['workbench.action.nextEditor', nextMode, ctrlTab],
	['workbench.action.previousEditor', nextMode, ctrlShiftTab],
] as const) {
	KeybindingsRegistry.registerKeybindingRule({ id, when, weight: KeybindingWeight.WorkbenchContrib + 1, ...keys });
}
