/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from "../../../base/common/event.js";
import type { ReviewSshPromptEvent } from "../../common/reviewSshPrompt.js";
import type { SshPromptRequest } from "./reviewSshAskpass.js";

export const REVIEW_SSH_WINDOW_WAIT_MS = 60_000;

export class ReviewSshPromptRelay {
	private nextId = 1;
	private readonly pending = new Map<number, { request: SshPromptRequest; resolve(answer: string | undefined): void }>();
	private windowTimer: ReturnType<typeof setTimeout> | undefined;

	private readonly emitter = new Emitter<ReviewSshPromptEvent>({
		onDidAddListener: () => {
			this.stopWaiting();
			for (const id of this.pending.keys()) this.show(id);
		},
		onDidRemoveLastListener: () => this.startWaiting(),
	});

	readonly onPrompt = this.emitter.event;

	constructor(private readonly windowWaitMs = REVIEW_SSH_WINDOW_WAIT_MS) {}

	prompt(request: SshPromptRequest): Promise<string | undefined> {
		return new Promise((resolve) => {
			const id = this.nextId++;
			this.pending.set(id, { request, resolve });
			request.signal?.addEventListener("abort", () => this.answer(id, undefined), { once: true });
			if (this.emitter.hasListeners()) this.show(id);
			else this.startWaiting();
		});
	}

	answer(id: number, answer: string | undefined): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		if (!this.pending.size) this.stopWaiting();
		pending.resolve(answer);
		this.emitter.fire({ id, closed: true });
	}

	dispose(): void {
		for (const id of [...this.pending.keys()]) this.answer(id, undefined);
		this.stopWaiting();
		this.emitter.dispose();
	}

	private show(id: number): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		const { alias, text, kind } = pending.request;
		this.emitter.fire({ id, alias, text, kind });
	}

	private startWaiting(): void {
		if (this.windowTimer || !this.pending.size) return;
		this.windowTimer = setTimeout(() => {
			this.windowTimer = undefined;
			for (const id of [...this.pending.keys()]) this.answer(id, undefined);
		}, this.windowWaitMs);
	}

	private stopWaiting(): void {
		clearTimeout(this.windowTimer);
		this.windowTimer = undefined;
	}
}

export const reviewSshPromptRelay = new ReviewSshPromptRelay();

export const reviewRemoteInstallPromptRelay = new ReviewSshPromptRelay();
