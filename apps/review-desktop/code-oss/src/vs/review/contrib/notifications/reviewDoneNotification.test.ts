import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewApiSummary } from "../../common/reviewProtocol.js";
import { completionBody, notifyReviewDone, ReviewCompletionTracker } from "./reviewDoneNotification.js";

const review = (working: boolean, extra: Partial<ReviewApiSummary> = {}): ReviewApiSummary => ({
	reviewId: "review", title: "Auth refactor", version: 1, createdAt: "", repositoryName: "repo",
	viewedAt: null, dismissedAt: null, working, ...extra,
});

test("notifies once when a review stops being authored", () => {
	const tracker = new ReviewCompletionTracker();
	assert.deepEqual(tracker.update([review(false)]), []);
	assert.deepEqual(tracker.update([review(true)]), []);
	assert.deepEqual(tracker.update([review(false)]), [review(false)]);
	assert.deepEqual(tracker.update([review(false)]), []);
	tracker.update([review(true)]);
	assert.deepEqual(tracker.update([review(false)]), [review(false)]);
});

test("deleted reviews, dismissed reviews and scratchpads stay quiet", () => {
	const tracker = new ReviewCompletionTracker();
	tracker.update([review(true)]);
	assert.deepEqual(tracker.update([]), []);
	assert.deepEqual(tracker.update([review(false)]), []);
	tracker.update([review(true)]);
	assert.deepEqual(tracker.update([review(false, { dismissedAt: "today" })]), []);
	tracker.update([review(true, { kind: "scratchpad" })]);
	assert.deepEqual(tracker.update([review(false, { kind: "scratchpad" })]), []);
});

test("completion counts include nested sections and distinguish unfinished sections", () => {
	assert.equal(completionBody([]), "Authoring finished");
	assert.equal(completionBody([{ type: "section", status: "complete", children: [
		{ type: "section", status: "pending" }, { type: "markdown" },
	] }]), "1 of 2 sections complete");
});

for (const viewing of [true, false]) for (const clicked of [true, false]) {
	test(`completion viewing=${viewing} clicked=${clicked} only focuses after activation`, async () => {
		const calls: string[] = [];
		await notifyReviewDone({ title: "Auth refactor", document: [] }, {
			isViewing: () => viewing,
			requestAttention: async () => { calls.push("attention"); },
			showToast: async options => {
				assert.deepEqual(options, { title: "Whiteboard ready: Auth refactor", body: "Authoring finished" });
				calls.push("toast");
				return { clicked };
			},
			openReview: async () => { calls.push("open"); },
			focus: async () => { calls.push("focus"); },
		});
		assert.deepEqual(calls, viewing ? [] : clicked ? ["attention", "toast", "open", "focus"] : ["attention", "toast"]);
	});
}
