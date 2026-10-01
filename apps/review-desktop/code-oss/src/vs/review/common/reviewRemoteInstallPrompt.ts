/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Desktop asks before it installs on a host, as ssh prompts are shown: main
 * fires the event on the Desktop channel, a window answers with the call.
 * The events are `ReviewSshPromptEvent`s.
 */
export const REVIEW_REMOTE_INSTALL_PROMPT_EVENT = "onRemoteInstallPrompt";
export const REVIEW_REMOTE_INSTALL_ANSWER_CALL = "answerRemoteInstallPrompt";

/** The answers; anything else, or none, decides nothing. */
export const REVIEW_REMOTE_INSTALL_YES = "install";
export const REVIEW_REMOTE_INSTALL_NO = "decline";
