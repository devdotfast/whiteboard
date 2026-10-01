/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IQuickInputService, IQuickPick, IQuickPickItem } from "../../../platform/quickinput/common/quickInput.js";
import { REVIEW_REMOTE_INSTALL_NO, REVIEW_REMOTE_INSTALL_YES } from "../../common/reviewRemoteInstallPrompt.js";
import type { ShownSshPrompt } from "./reviewSshPromptInput.js";

/**
 * Install or not. The text names the host's paths, so it goes in
 * `description`, which is plain text.
 */
export function createRemoteInstallPromptInput(
	quickInputService: Pick<IQuickInputService, "createQuickPick">,
	prompt: ShownSshPrompt,
	title: string,
	labels: { install: string; decline: string },
	accept: (answer: string | undefined) => void,
): IQuickPick<IQuickPickItem & { answer: string }> {
	const pick = quickInputService.createQuickPick<IQuickPickItem & { answer: string }>();
	pick.items = [
		{ label: labels.install, answer: REVIEW_REMOTE_INSTALL_YES },
		{ label: labels.decline, answer: REVIEW_REMOTE_INSTALL_NO },
	];
	pick.onDidAccept(() => accept(pick.selectedItems[0]?.answer));
	pick.title = title;
	pick.description = prompt.text;
	pick.ignoreFocusOut = true;
	return pick;
}
