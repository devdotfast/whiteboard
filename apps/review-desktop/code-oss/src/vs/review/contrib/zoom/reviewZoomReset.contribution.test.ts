/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { createSimpleKeybinding, KeyCodeChord } from '../../../base/common/keybindings.js';
import { OS } from '../../../base/common/platform.js';
import { KeybindingResolver } from '../../../platform/keybinding/common/keybindingResolver.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';
import { ResolvedKeybindingItem } from '../../../platform/keybinding/common/resolvedKeybindingItem.js';
import { USLayoutResolvedKeybinding } from '../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import './reviewZoomReset.contribution.js';

// Stands in for upstream's Focus Side Bar, which a workspace window registers
// on the same chord. Registered last, so it wins any tie on weight.
KeybindingsRegistry.registerKeybindingRule({
	id: 'workbench.action.focusSideBar',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.Digit0,
});

function commandFor(keybinding: number): string | null | undefined {
	const items = KeybindingsRegistry.getDefaultKeybindings().map(item => new ResolvedKeybindingItem(
		item.keybinding ? new USLayoutResolvedKeybinding(item.keybinding.chords.filter(chord => chord instanceof KeyCodeChord), OS) : undefined,
		item.command, item.commandArgs, item.when ?? undefined, true, item.extensionId, item.isBuiltinExtension,
	));
	const [chord] = new USLayoutResolvedKeybinding([createSimpleKeybinding(keybinding, OS)], OS).getDispatchChords();
	const result = new KeybindingResolver(items, [], () => { }).resolve({ getValue: () => undefined }, [], chord!);
	return 'commandId' in result ? result.commandId : undefined;
}

test('Cmd/Ctrl+0 resets the zoom where Focus Side Bar claims the same chord', () => {
	assert.equal(commandFor(KeyMod.CtrlCmd | KeyCode.Digit0), 'workbench.action.zoomReset');
});
