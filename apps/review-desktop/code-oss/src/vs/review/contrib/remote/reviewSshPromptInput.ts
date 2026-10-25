/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IQuickInput, IQuickInputService, IQuickPickItem } from "../../../platform/quickinput/common/quickInput.js";
import { REVIEW_REMOTE_INSTALL_NO, REVIEW_REMOTE_INSTALL_YES, type ReviewSshPromptEvent } from "../../common/reviewSshPrompt.js";

export type ShownSshPrompt = Exclude<ReviewSshPromptEvent, { closed: true }>;

export function createSshPromptInput(
	quickInputService: Pick<IQuickInputService, "createInputBox" | "createQuickPick">,
	prompt: ShownSshPrompt,
	title: string,
	accept: (answer: string | undefined) => void,
	labels: { install: string; decline: string },
): IQuickInput {
	let input: IQuickInput;
	if (prompt.kind === "confirm" || prompt.kind === "install") {
		const pick = quickInputService.createQuickPick<IQuickPickItem & { answer: string }>();
		pick.items =
			prompt.kind === "install"
				? [
						{ label: labels.install, answer: REVIEW_REMOTE_INSTALL_YES },
						{ label: labels.decline, answer: REVIEW_REMOTE_INSTALL_NO },
					]
				: [
						{ label: "yes", answer: "yes" },
						{ label: "no", answer: "no" },
					];
		pick.onDidAccept(() => accept(pick.selectedItems[0]?.answer));
		input = pick;
	} else {
		const box = quickInputService.createInputBox();
		box.password = prompt.kind === "secret";
		box.onDidAccept(() => accept(box.value));
		box.onWillHide(() => (box.value = ""));
		input = box;
	}
	input.title = title;
	input.description = prompt.kind === "install" ? undefined : prompt.text;
	input.ignoreFocusOut = true;
	return input;
}
