/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/** What `ssh` asks for: `secret` input is hidden, `confirm` is yes or no. */
export type SshPromptKind = "secret" | "confirm" | "text";

/** Main to window: show a prompt, or close one that was answered or abandoned. */
export type ReviewSshPromptEvent =
	| { readonly id: number; readonly alias: string; readonly text: string; readonly kind: SshPromptKind }
	| { readonly id: number; readonly closed: true };

/** Desktop channel event the window listens to, and the call it answers with. */
export const REVIEW_SSH_PROMPT_EVENT = "onSshPrompt";
export const REVIEW_SSH_ANSWER_CALL = "answerSshPrompt";

/** Set by the askpass script's caller for the helper; never an answer. */
export const REVIEW_SSH_ASKPASS_SOCKET_ENV = "DEV_FAST_REVIEW_SSH_ASKPASS_SOCKET";
export const REVIEW_SSH_ASKPASS_ALIAS_ENV = "DEV_FAST_REVIEW_SSH_ASKPASS_ALIAS";

export function sshPromptKind(text: string): SshPromptKind {
	if (/yes\/no/i.test(text)) return "confirm";
	if (/passphrase|password/i.test(text)) return "secret";
	return "text";
}
