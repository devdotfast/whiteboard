/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ty's prompt opens the extensions view, which Whiteboard does not ship.
export function isSuppressedExtensionMessage(extensionId: string | undefined, message: string): boolean {
	return extensionId?.toLowerCase() === 'astral-sh.ty' && message.startsWith('No Python environment extension is available.');
}
