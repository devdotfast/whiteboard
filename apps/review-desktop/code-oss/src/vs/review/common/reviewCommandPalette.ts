/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stripIcons } from '../../base/common/iconLabels.js';
import { localize } from '../../nls.js';
import type { ICommandAction } from '../../platform/action/common/action.js';

export const REVIEW_OPEN_HOME_COMMAND_ID = 'review.openHome';
export const REVIEW_OPEN_SETTINGS_COMMAND_ID = 'review.openSettings';

type CommandLabel = Pick<ICommandAction, 'title' | 'category'>;

const stockPaletteCommands = new Set(['workbench.action.reloadWindow']);

/**
 * Whether a command belongs in Whiteboard's Command Palette. Whiteboard's own
 * commands do, plus a few stock ones; other stock and extension commands keep
 * their keybindings but are never listed.
 */
export function isReviewPaletteCommand(commandId: string): boolean {
	return commandId.startsWith('review.') || commandId.startsWith('whiteboard.') || stockPaletteCommands.has(commandId);
}

export function reviewCommandPaletteLabel(commandId: string, command: CommandLabel | undefined): string {
	if (!command) {
		return commandId;
	}

	let label = typeof command.title === 'string' ? command.title : command.title.value;
	const category = typeof command.category === 'string' ? command.category : command.category?.value;
	if (category) {
		label = localize('review.commandWithCategory', "{0}: {1}", category, label);
	}

	return stripIcons(label) || commandId;
}
