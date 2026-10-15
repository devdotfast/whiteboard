/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ms-python ships only as a ty and ruff dependency, and no setting hides its interpreter toasts.
export function isSuppressedExtensionMessage(extensionId: string | undefined, message: string): boolean {
	return extensionId?.toLowerCase() === 'ms-python.python' && message.includes(' Python interpreter is selected');
}
