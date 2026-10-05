/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SshPromptKind = "secret" | "confirm" | "text";

export type ReviewSshPromptEvent =
	| { readonly id: number; readonly alias: string; readonly text: string; readonly kind: SshPromptKind }
	| { readonly id: number; readonly closed: true };

export const REVIEW_SSH_PROMPT_EVENT = "onSshPrompt";
export const REVIEW_SSH_ANSWER_CALL = "answerSshPrompt";

export const REVIEW_SSH_ASKPASS_SOCKET_ENV = "DEV_FAST_REVIEW_SSH_ASKPASS_SOCKET";
export const REVIEW_SSH_ASKPASS_ALIAS_ENV = "DEV_FAST_REVIEW_SSH_ASKPASS_ALIAS";

export function sshPromptKind(text: string): SshPromptKind {
	if (/yes\/no/i.test(text)) return "confirm";
	if (/passphrase|password/i.test(text)) return "secret";
	return "text";
}
