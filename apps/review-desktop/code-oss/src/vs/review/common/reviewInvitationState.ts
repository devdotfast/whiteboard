import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import type { ReviewFeedbackState } from './reviewFeedbackState.js';

const REVIEW_INVITATION_STATE_KEY = 'review.invitations.v1';
const LEGACY_DISCORD_DISMISSED_KEY = 'review.community.dontShowAgain';
export const INVITATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const FEEDBACK_COOLDOWN_MS = 7 * INVITATION_COOLDOWN_MS;
export type ReviewInvitation = 'email' | 'discord' | 'feedback';

/** Offered records display, not consent. No email address is stored locally. */
export interface ReviewInvitationState {
	email: 'ineligible' | 'onboarding' | 'pending' | 'offered' | 'retired';
	discord: 'pending' | 'offered';
	contactSavedAt?: number;
	lastPrompt?: { kind: ReviewInvitation; at: number; sessionId: string };
}

export function readReviewInvitationState(storage: IStorageService): ReviewInvitationState {
	return storage.getObject<ReviewInvitationState>(REVIEW_INVITATION_STATE_KEY, StorageScope.APPLICATION) ?? {
		email: 'ineligible',
		discord: storage.getBoolean(LEGACY_DISCORD_DISMISSED_KEY, StorageScope.APPLICATION, false) ? 'offered' : 'pending',
	};
}

// Missing state must not enroll existing users in the email invitation.
export function beginReviewEmailOnboarding(storage: IStorageService): void {
	if (storage.isNew(StorageScope.APPLICATION) && readReviewInvitationState(storage).email === 'ineligible') {
		updateReviewInvitationState(storage, { email: 'onboarding' });
	}
}

export function updateReviewInvitationState(storage: IStorageService, update: Partial<ReviewInvitationState>): void {
	storage.store(REVIEW_INVITATION_STATE_KEY, { ...readReviewInvitationState(storage), ...update }, StorageScope.APPLICATION, StorageTarget.MACHINE);
}

export function markReviewInvitationOffered(storage: IStorageService, kind: ReviewInvitation, sessionId: string, now = Date.now()): void {
	const update: Partial<ReviewInvitationState> = { lastPrompt: { kind, at: now, sessionId } };
	if (kind === 'discord') update.discord = 'offered';
	else update.email = kind === 'email' ? 'offered' : 'retired';
	updateReviewInvitationState(storage, update);
}

export function hasSharedReviewEmail(storage: IStorageService): boolean {
	return readReviewInvitationState(storage).contactSavedAt !== undefined;
}

export interface ReviewInvitationEligibility {
	now: number;
	sessionId: string;
	feedbackEligible: boolean;
	feedback: ReviewFeedbackState;
	/** Snapshot at app startup: Discord waits for a later session. */
	initialBoardCount: number;
}

export function nextReviewInvitation(state: ReviewInvitationState, input: ReviewInvitationEligibility): ReviewInvitation | undefined {
	const coolingDown = state.lastPrompt && (
		state.lastPrompt.sessionId === input.sessionId || input.now - state.lastPrompt.at < INVITATION_COOLDOWN_MS
	);
	if (coolingDown) return;

	const feedback = input.feedback;
	const feedbackReady = input.feedbackEligible && feedback.status === 'pending' &&
		feedback.lastPromptSessionId !== input.sessionId &&
		(feedback.lastPromptAt === undefined || input.now - feedback.lastPromptAt >= FEEDBACK_COOLDOWN_MS);
	if (feedbackReady) return 'feedback';

	if (!input.feedbackEligible && feedback.status !== 'submitted' && state.email === 'pending' &&
		state.contactSavedAt === undefined) return 'email';

	if (state.discord === 'pending' && input.initialBoardCount >= 2) return 'discord';
	return undefined;
}
