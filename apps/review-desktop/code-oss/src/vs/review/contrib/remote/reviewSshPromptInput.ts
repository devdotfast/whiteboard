/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IQuickInput, IQuickInputService, IQuickPickItem } from "../../../platform/quickinput/common/quickInput.js";
import type { ReviewSshPromptEvent } from "../../common/reviewSshPrompt.js";

export type ShownSshPrompt = Exclude<ReviewSshPromptEvent, { closed: true }>;

export function createSshPromptInput(
	quickInputService: Pick<IQuickInputService, "createInputBox" | "createQuickPick">,
	prompt: ShownSshPrompt,
	title: string,
	accept: (answer: string | undefined) => void,
): IQuickInput {
	let input: IQuickInput;
	if (prompt.kind === "confirm") {
		const pick = quickInputService.createQuickPick<IQuickPickItem>();
		pick.items = [{ label: "yes" }, { label: "no" }];
		pick.onDidAccept(() => accept(pick.selectedItems[0]?.label));
		input = pick;
	} else {
		const box = quickInputService.createInputBox();
		box.password = prompt.kind === "secret";
		box.onDidAccept(() => accept(box.value));
		box.onWillHide(() => (box.value = ""));
		input = box;
	}
	input.title = title;
	input.description = prompt.text;
	input.ignoreFocusOut = true;
	return input;
}
