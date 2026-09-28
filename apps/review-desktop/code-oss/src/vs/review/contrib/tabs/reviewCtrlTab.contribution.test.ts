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
import './reviewCtrlTab.contribution.js';

const ctrl = OS === OperatingSystem.Macintosh ? KeyMod.WinCtrl : KeyMod.CtrlCmd;

// Stands in for upstream's recent-editors picker on the same chords.
// Registered last, so it wins any tie on weight.
for (const [id, primary] of [
	['workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup', ctrl | KeyCode.Tab],
	['workbench.action.quickOpenLeastRecentlyUsedEditorInGroup', ctrl | KeyMod.Shift | KeyCode.Tab],
] as const) {
	KeybindingsRegistry.registerKeybindingRule({ id, weight: KeybindingWeight.WorkbenchContrib, primary });
}

function commandFor(keybinding: number, ctrlTab: string | undefined): string | null | undefined {
	const items = KeybindingsRegistry.getDefaultKeybindings().map(item => new ResolvedKeybindingItem(
		item.keybinding ? new USLayoutResolvedKeybinding(item.keybinding.chords.filter(chord => chord instanceof KeyCodeChord), OS) : undefined,
		item.command, item.commandArgs, item.when ?? undefined, true, item.extensionId, item.isBuiltinExtension,
	));
	const [chord] = new USLayoutResolvedKeybinding([createSimpleKeybinding(keybinding, OS)], OS).getDispatchChords();
	const context = { getValue: <T,>(key: string) => (key === 'config.review.tabs.ctrlTab' ? ctrlTab : undefined) as T | undefined };
	const result = new KeybindingResolver(items, [], () => { }).resolve(context, [], chord!);
	return 'commandId' in result ? result.commandId : undefined;
}

test('Ctrl+Tab and Ctrl+Shift+Tab open the last used tab by default', () => {
	assert.equal(commandFor(ctrl | KeyCode.Tab, undefined), 'review.openLastUsedTab');
	assert.equal(commandFor(ctrl | KeyCode.Tab, 'recent'), 'review.openLastUsedTab');
	assert.equal(commandFor(ctrl | KeyMod.Shift | KeyCode.Tab, 'recent'), 'review.openLastUsedTab');
});

test('Ctrl+Tab and Ctrl+Shift+Tab walk the tab bar when set to next', () => {
	assert.equal(commandFor(ctrl | KeyCode.Tab, 'next'), 'workbench.action.nextEditor');
	assert.equal(commandFor(ctrl | KeyMod.Shift | KeyCode.Tab, 'next'), 'workbench.action.previousEditor');
});
