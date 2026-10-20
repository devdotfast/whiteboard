/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { createSimpleKeybinding, KeyCodeChord } from '../../../base/common/keybindings.js';
import { OperatingSystem, OS } from '../../../base/common/platform.js';
import { KeybindingResolver } from '../../../platform/keybinding/common/keybindingResolver.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { ResolvedKeybindingItem } from '../../../platform/keybinding/common/resolvedKeybindingItem.js';
import { USLayoutResolvedKeybinding } from '../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { REVIEW_BOARD_ACTIVE, REVIEW_HOME_ACTIVE } from './reviewWindowKeys.js';

const ctrl = OS === OperatingSystem.Macintosh ? KeyMod.WinCtrl : KeyMod.CtrlCmd;
const tab = OS === OperatingSystem.Macintosh ? KeyMod.WinCtrl : KeyMod.Alt;

// Upstream's bindings on the same chords, registered last so they would win
// any tie on weight.
for (const [id, primary] of [
	['workbench.action.closeActiveEditor', KeyMod.CtrlCmd | KeyCode.KeyW],
	['workbench.action.focusFirstEditorGroup', KeyMod.CtrlCmd | KeyCode.Digit1],
	['workbench.action.focusThirdEditorGroup', KeyMod.CtrlCmd | KeyCode.Digit3],
	['workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup', ctrl | KeyCode.Tab],
	['workbench.action.quickOpenLeastRecentlyUsedEditorInGroup', ctrl | KeyMod.Shift | KeyCode.Tab],
	['workbench.action.toggleAuxiliaryBar', KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB],
	['workbench.action.openEditorAtIndex1', tab | KeyCode.Digit1],
	['workbench.action.openEditorAtIndex9', tab | KeyCode.Digit9],
] as const) {
	KeybindingsRegistry.registerKeybindingRule({ id, weight: KeybindingWeight.WorkbenchContrib, primary });
}

function commandFor(keybinding: number, context: Record<string, boolean> = {}): string | null | undefined {
	const items = KeybindingsRegistry.getDefaultKeybindings().map(item => new ResolvedKeybindingItem(
		item.keybinding ? new USLayoutResolvedKeybinding(item.keybinding.chords.filter(chord => chord instanceof KeyCodeChord), OS) : undefined,
		item.command, item.commandArgs, item.when ?? undefined, true, item.extensionId, item.isBuiltinExtension,
	));
	const [chord] = new USLayoutResolvedKeybinding([createSimpleKeybinding(keybinding, OS)], OS).getDispatchChords();
	const values = { getValue: <T,>(key: string) => context[key] as T | undefined };
	const result = new KeybindingResolver(items, [], () => { }).resolve(values, [], chord!);
	return 'commandId' in result ? result.commandId : undefined;
}

test('⌘W closes the window from a board or Home, and closes the editor anywhere else', () => {
	const closeW = KeyMod.CtrlCmd | KeyCode.KeyW;

	assert.equal(commandFor(closeW, { [REVIEW_BOARD_ACTIVE]: true }), 'workbench.action.closeWindow');
	assert.equal(commandFor(closeW, { [REVIEW_HOME_ACTIVE]: true }), 'workbench.action.closeWindow');
	// Settings, Welcome or a file: back to the board.
	assert.equal(commandFor(closeW), 'workbench.action.closeActiveEditor');
});

test('⌘1–⌘3 pick the sidebar tabs over focusing editor groups', () => {
	assert.equal(commandFor(KeyMod.CtrlCmd | KeyCode.Digit1), 'review.sidebar.showWhiteboard');
	assert.equal(commandFor(KeyMod.CtrlCmd | KeyCode.Digit2), 'review.sidebar.showDiff');
	assert.equal(commandFor(KeyMod.CtrlCmd | KeyCode.Digit3), 'review.sidebar.showThreads');
});

test('Ctrl+Tab and Ctrl+Shift+Tab walk recent boards over the recent-editors picker', () => {
	assert.equal(commandFor(ctrl | KeyCode.Tab), 'review.openRecentBoard');
	assert.equal(commandFor(ctrl | KeyMod.Shift | KeyCode.Tab), 'review.openRecentBoardBack');
});

test('⌥⌘B toggles the Ask column, never the secondary side bar', () => {
	const chord = KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB;

	assert.equal(commandFor(chord, { [REVIEW_BOARD_ACTIVE]: true }), 'review.toggleAskColumn');
	assert.equal(commandFor(chord, { [REVIEW_HOME_ACTIVE]: true }), 'review.toggleAskColumn');
	assert.equal(commandFor(chord), 'review.toggleAskColumn');
});

test('⌥1–⌥9 (⌃1–⌃9 on macOS) go to no tab: the window has no tab strip', () => {
	assert.equal(commandFor(tab | KeyCode.Digit1), 'review.keepOneBoard');
	assert.equal(commandFor(tab | KeyCode.Digit9), 'review.keepOneBoard');
	assert.equal(commandFor(tab | KeyCode.Digit1, { [REVIEW_BOARD_ACTIVE]: true }), 'review.keepOneBoard');
});
