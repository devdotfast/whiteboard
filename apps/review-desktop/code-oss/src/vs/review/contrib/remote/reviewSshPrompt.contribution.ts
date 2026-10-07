/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from "../../../base/common/lifecycle.js";
import { localize } from "../../../nls.js";
import { IMainProcessService } from "../../../platform/ipc/common/mainProcessService.js";
import { IQuickInputService, type IQuickInput } from "../../../platform/quickinput/common/quickInput.js";
import { registerWorkbenchContribution2, WorkbenchPhase } from "../../../workbench/common/contributions.js";
import { REVIEW_DESKTOP_CHANNEL } from "../../common/reviewDesktopBootstrap.js";
import { REVIEW_SSH_ANSWER_CALL, REVIEW_SSH_PROMPT_EVENT, type ReviewSshPromptEvent } from "../../common/reviewSshPrompt.js";
import { createSshPromptInput, type ShownSshPrompt } from "./reviewSshPromptInput.js";

class ReviewSshPrompts extends Disposable {
	static readonly ID = "review.sshPrompts";

	private current: { id: number; input: IQuickInput } | undefined;
	private closing = false;

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super();
		const channel = this.mainProcessService.getChannel(REVIEW_DESKTOP_CHANNEL);
		this._register(
			channel.listen<ReviewSshPromptEvent>(REVIEW_SSH_PROMPT_EVENT)((event) => {
				if ("closed" in event) {
					if (this.current?.id === event.id) this.current.input.dispose();
				} else if (this.current?.id !== event.id) this.show(event);
			}),
		);
		this._register({
			dispose: () => {
				this.closing = true;
				this.current?.input.dispose();
			},
		});
	}

	private show(prompt: ShownSshPrompt): void {
		this.current?.input.dispose();
		let settled = false;
		const settle = (answer: string | undefined) => {
			if (settled) return;
			settled = true;
			if (this.current?.id === prompt.id) this.current = undefined;
			if (!this.closing) void this.mainProcessService.getChannel(REVIEW_DESKTOP_CHANNEL).call(REVIEW_SSH_ANSWER_CALL, { id: prompt.id, answer });
			input.dispose();
		};

		const input = createSshPromptInput(
			this.quickInputService,
			prompt,
			localize("review.sshPrompt.title", "SSH: {0}", prompt.alias),
			settle,
		);
		input.onDidHide(() => settle(undefined));
		this.current = { id: prompt.id, input };
		input.show();
	}
}

registerWorkbenchContribution2(ReviewSshPrompts.ID, ReviewSshPrompts, WorkbenchPhase.AfterRestored);
