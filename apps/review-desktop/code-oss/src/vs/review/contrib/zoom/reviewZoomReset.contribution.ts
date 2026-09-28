/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../base/common/keyCodes.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../platform/keybinding/common/keybindingsRegistry.js';

/**
 * `Cmd+0` resets the zoom, as it does in a browser. Upstream binds Reset Zoom
 * to the numpad's zero alone, in `workbench/electron-browser/actions/windowActions.ts`,
 * and gives the top-row zero to Focus Side Bar, which a workspace window
 * registers at `WorkbenchContrib`. At equal weight the last rule registered
 * wins, so this asks for one more to take the chord in every window.
 */
KeybindingsRegistry.registerKeybindingRule({
	id: 'workbench.action.zoomReset',
	weight: KeybindingWeight.WorkbenchContrib + 1,
	primary: KeyMod.CtrlCmd | KeyCode.Digit0,
});
