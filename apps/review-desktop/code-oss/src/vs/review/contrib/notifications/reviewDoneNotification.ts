import type { ReviewApiSummary } from "../../common/reviewProtocol.js";

export class ReviewCompletionTracker {
	private working = new Set<string>();

	update(reviews: readonly ReviewApiSummary[]): ReviewApiSummary[] {
		const finished = reviews.filter(review =>
			this.working.has(review.reviewId) && review.working === false && !review.dismissedAt && review.kind !== "scratchpad",
		);
		this.working = new Set(reviews.filter(review => review.working).map(review => review.reviewId));
		return finished;
	}
}

interface SectionContent {
	type: string;
	status?: string;
	children?: SectionContent[];
}

export interface FinishedReview {
	title: string;
	document: SectionContent[];
}

export function completionBody(document: SectionContent[]): string {
	let total = 0;
	let complete = 0;
	const visit = (items: SectionContent[]) => {
		for (const item of items) {
			if (item.type === "section") {
				total++;
				if (item.status === "complete") complete++;
			}
			if (item.children) visit(item.children);
		}
	};
	visit(document);
	return total ? `${complete} of ${total} sections complete` : "Authoring finished";
}

export async function notifyReviewDone(review: FinishedReview, effects: {
	isViewing(): boolean;
	requestAttention(): Promise<void>;
	showToast(options: { title: string; body: string }): Promise<{ clicked: boolean }>;
	openReview(): Promise<void>;
	focus(): Promise<void>;
}): Promise<void> {
	if (effects.isViewing()) return;
	await effects.requestAttention();
	const result = await effects.showToast({ title: `Whiteboard ready: ${review.title}`, body: completionBody(review.document) });
	if (!result.clicked) return;
	await effects.openReview();
	await effects.focus();
}
