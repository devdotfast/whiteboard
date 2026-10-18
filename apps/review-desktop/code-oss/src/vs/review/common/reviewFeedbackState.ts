/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { firstSessionDateStorageKey } from '../../platform/telemetry/common/telemetry.js';
import { REVIEW_FEEDBACK_CAMPAIGN } from './reviewProtocol.js';

export const REVIEW_FEEDBACK_STATE_KEY = `review.feedback.${REVIEW_FEEDBACK_CAMPAIGN}.state`;
const MIN_INSTALL_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Reuse Desktop's first-launch date, including telemetry-off installs. */
export function reviewFeedbackInstallReadyAt(storage: IStorageService): number {
  const firstSessionAt = Date.parse(storage.get(firstSessionDateStorageKey, StorageScope.APPLICATION) ?? '');
  return firstSessionAt + MIN_INSTALL_AGE_MS;
}

/** Only campaign status is stored here; age and activity are read separately. */
export type ReviewFeedbackState =
  | { status: 'pending'; lastPromptSessionId?: string }
  | { status: 'submitted' };

export function readReviewFeedbackState(storage: IStorageService): ReviewFeedbackState {
  return storage.getObject<ReviewFeedbackState>(REVIEW_FEEDBACK_STATE_KEY, StorageScope.APPLICATION, { status: 'pending' });
}

/** Skip, close, and manual opening suppress further invitations in this app run. */
export function markReviewFeedbackPrompted(storage: IStorageService, appSessionId: string): void {
  storage.store(REVIEW_FEEDBACK_STATE_KEY, { status: 'pending', lastPromptSessionId: appSessionId }, StorageScope.APPLICATION, StorageTarget.MACHINE);
}

/** Call only after the receiver confirms that it saved the response. */
export function markReviewFeedbackSubmitted(storage: IStorageService): void {
  storage.store(REVIEW_FEEDBACK_STATE_KEY, { status: 'submitted' }, StorageScope.APPLICATION, StorageTarget.MACHINE);
}

/** Developer reset clears only this campaign, preserving install age and activity. */
export function resetReviewFeedbackState(storage: IStorageService): void {
  storage.remove(REVIEW_FEEDBACK_STATE_KEY, StorageScope.APPLICATION);
}
