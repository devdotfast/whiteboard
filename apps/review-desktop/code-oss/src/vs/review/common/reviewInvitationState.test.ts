import assert from 'node:assert/strict';
import test from 'node:test';
import type { IStorageService } from '../../platform/storage/common/storage.js';
import { markReviewFeedbackPrompted, markReviewFeedbackSubmitted, readReviewFeedbackState } from './reviewFeedbackState.js';
import { FEEDBACK_COOLDOWN_MS, INVITATION_COOLDOWN_MS, beginReviewEmailOnboarding, hasSharedReviewEmail, markReviewInvitationOffered, nextReviewInvitation, readReviewInvitationState, updateReviewInvitationState, type ReviewInvitationEligibility, type ReviewInvitationState } from './reviewInvitationState.js';

function storageFixture(legacyDiscord = false, firstLaunch = false) {
  const values = new Map<string, unknown>([['review.community.dontShowAgain', legacyDiscord]]);
  return {
    isNew: () => firstLaunch,
    getObject: (key: string, _scope: unknown, fallback?: unknown) => values.get(key) ?? fallback,
    getBoolean: (key: string, _scope: unknown, fallback?: boolean) => values.get(key) ?? fallback,
    store: (key: string, value: unknown) => values.set(key, structuredClone(value)),
  } as unknown as IStorageService;
}
const initial: ReviewInvitationState = { email: 'onboarding', discord: 'pending' };
const eligibility: ReviewInvitationEligibility = { now: 100 * INVITATION_COOLDOWN_MS, sessionId: 'a', feedbackEligible: false, feedback: { status: 'pending' }, initialBoardCount: 0 };

test('email → later-session Discord → eligible feedback, without requiring acceptance', () => {
  const storage = storageFixture();
  updateReviewInvitationState(storage, { email: 'pending' });
  markReviewInvitationOffered(storage, 'email', 'a', eligibility.now);
  assert.equal(hasSharedReviewEmail(storage), false, 'an invitation is not consent');
  assert.equal(nextReviewInvitation(readReviewInvitationState(storage), { ...eligibility, initialBoardCount: 2 }), undefined);
  const nextDay = { ...eligibility, now: eligibility.now + INVITATION_COOLDOWN_MS, sessionId: 'b', initialBoardCount: 2 };
  assert.equal(nextReviewInvitation(readReviewInvitationState(storage), nextDay), 'discord');
  markReviewInvitationOffered(storage, 'discord', 'b', nextDay.now);
  assert.equal(nextReviewInvitation(readReviewInvitationState(storage), { ...nextDay, sessionId: 'c', now: nextDay.now + INVITATION_COOLDOWN_MS, feedbackEligible: true }), 'feedback');
});
test('shared cooldown applies across sessions, including clock rollback', () => {
  const storage = storageFixture();
  markReviewInvitationOffered(storage, 'email', 'a', eligibility.now);
  for (const offset of [-1000, 0, INVITATION_COOLDOWN_MS - 1]) {
    assert.equal(nextReviewInvitation(readReviewInvitationState(storage), { ...eligibility, sessionId: 'b', now: eligibility.now + offset, feedbackEligible: true }), undefined);
  }
  assert.equal(nextReviewInvitation(readReviewInvitationState(storage), { ...eligibility, now: eligibility.now + 10 * INVITATION_COOLDOWN_MS, feedbackEligible: true }), undefined, 'one invitation per app session');
});
test('feedback takes priority without email or Discord acceptance; its email retirement persists', () => {
  assert.equal(nextReviewInvitation({ ...initial, email: 'pending' }, { ...eligibility, initialBoardCount: 2, feedbackEligible: true }), 'feedback');
  const storage = storageFixture();
  markReviewInvitationOffered(storage, 'feedback', 'a', eligibility.now);
  assert.equal(readReviewInvitationState(storage).email, 'retired');
  assert.equal(nextReviewInvitation(readReviewInvitationState(storage), { ...eligibility, sessionId: 'b', now: eligibility.now + INVITATION_COOLDOWN_MS }), undefined);
});
test('feedback skips defer seven days, submitted campaigns stay complete, Discord may still follow', () => {
  const storage = storageFixture();
  markReviewFeedbackPrompted(storage, 'a', eligibility.now);
  const state = { ...initial, email: 'retired' as const };
  const input = { ...eligibility, sessionId: 'b', feedbackEligible: true, feedback: readReviewFeedbackState(storage) };
  assert.equal(nextReviewInvitation(state, { ...input, now: eligibility.now + FEEDBACK_COOLDOWN_MS - 1 }), undefined);
  assert.equal(nextReviewInvitation(state, { ...input, now: eligibility.now + FEEDBACK_COOLDOWN_MS }), 'feedback');
  markReviewFeedbackSubmitted(storage);
  assert.equal(nextReviewInvitation(state, { ...input, feedback: readReviewFeedbackState(storage), initialBoardCount: 2 }), 'discord');
});
test('legacy Discord dismissal and submitted feedback survive writing new history', () => {
  const storage = storageFixture(true);
  markReviewFeedbackSubmitted(storage);
  updateReviewInvitationState(storage, { email: 'pending' });
  assert.equal(readReviewInvitationState(storage).discord, 'offered');
  assert.equal(nextReviewInvitation(readReviewInvitationState(storage), { ...eligibility, feedback: readReviewFeedbackState(storage), initialBoardCount: 2 }), undefined);
});
test('confirmed contact suppresses email independently of campaign completion', () => {
  const storage = storageFixture();
  updateReviewInvitationState(storage, { email: 'pending', contactSavedAt: eligibility.now });
  assert.equal(hasSharedReviewEmail(storage), true);
  assert.equal(nextReviewInvitation(readReviewInvitationState(storage), eligibility), undefined);
  assert.equal(nextReviewInvitation(readReviewInvitationState(storage), { ...eligibility, feedbackEligible: true }), 'feedback');
});

for (const firstLaunch of [true, false]) {
  test(`${firstLaunch ? 'new' : 'existing'} installation: only first launch can enroll the email invitation`, () => {
    const storage = storageFixture(false, firstLaunch);
    assert.equal(readReviewInvitationState(storage).email, 'ineligible');
    assert.equal(nextReviewInvitation(readReviewInvitationState(storage), eligibility), undefined);
    beginReviewEmailOnboarding(storage);
    assert.equal(readReviewInvitationState(storage).email, firstLaunch ? 'onboarding' : 'ineligible');
    assert.equal(nextReviewInvitation(readReviewInvitationState(storage), eligibility), undefined);
  });
}
test('onboarding cannot re-enroll a resolved email invitation', () => {
  const storage = storageFixture(false, true);
  updateReviewInvitationState(storage, { email: 'retired' });
  beginReviewEmailOnboarding(storage);
  assert.equal(readReviewInvitationState(storage).email, 'retired');
});
