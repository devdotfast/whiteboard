/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';

/**
 * The window's keys with no tab strip. Each is one weight above upstream's
 * binding on the same chord.
 */

/** Set while a board is the active editor, whichever view it shows. */
export const REVIEW_BOARD_ACTIVE = 'reviewBoardActive';
/** Set while Home is the active editor. */
export const REVIEW_HOME_ACTIVE = 'reviewHomeActive';

export const REVIEW_SIDEBAR_TAB_COMMANDS = [
	'review.sidebar.showWhiteboard',
	'review.sidebar.showDiff',
	'review.sidebar.showThreads',
] as const;

export const REVIEW_OPEN_RECENT_BOARD = 'review.openRecentBoard';
export const REVIEW_OPEN_RECENT_BOARD_BACK = 'review.openRecentBoardBack';

const above = KeybindingWeight.WorkbenchContrib + 1;

// ⌘W on a board or Home closes the window, as the last tab of a browser
// window does; macOS keeps the app running. Settings, Welcome and other
// editors still close back to the board.
KeybindingsRegistry.registerKeybindingRule({
	id: 'workbench.action.closeWindow',
	when: ContextKeyExpr.or(ContextKeyExpr.has(REVIEW_BOARD_ACTIVE), ContextKeyExpr.has(REVIEW_HOME_ACTIVE)),
	primary: KeyMod.CtrlCmd | KeyCode.KeyW,
	weight: above,
});

// ⌘1–⌘3 pick the sidebar's tabs, over "Focus Nth Editor Group", which has
// nothing to focus in a window of one group.
const digits = [KeyCode.Digit1, KeyCode.Digit2, KeyCode.Digit3];
for (const [index, id] of REVIEW_SIDEBAR_TAB_COMMANDS.entries()) {
	KeybindingsRegistry.registerKeybindingRule({ id, primary: KeyMod.CtrlCmd | digits[index], weight: above });
}

// Ctrl+Tab and Ctrl+Shift+Tab walk the boards opened last, over upstream's
// recent-editors picker.
KeybindingsRegistry.registerKeybindingRule({
	id: REVIEW_OPEN_RECENT_BOARD,
	primary: KeyMod.CtrlCmd | KeyCode.Tab,
	mac: { primary: KeyMod.WinCtrl | KeyCode.Tab },
	weight: above,
});
KeybindingsRegistry.registerKeybindingRule({
	id: REVIEW_OPEN_RECENT_BOARD_BACK,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Tab,
	mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Tab },
	weight: above,
});

// ⌘\ splits nothing: a window shows one board at a time.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'review.keepOneBoard',
	primary: KeyMod.CtrlCmd | KeyCode.Backslash,
	weight: above,
	handler: () => undefined,
});

// ⌥⌘B puts the right column away or brings it back, everywhere, over
// upstream's secondary side bar toggle: Review has no secondary side bar.
KeybindingsRegistry.registerKeybindingRule({
	id: 'review.toggleAskColumn',
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB,
	weight: above,
});
