import type { ReviewApiSummary } from "../../../common/reviewProtocol.js";

type RemoteFields = Pick<ReviewApiSummary, "host" | "available">;

/** What a review's canvas learns from its list entry: the host is a label, and what it cannot open. */
export const remoteEntry = (review: ReviewApiSummary | undefined): RemoteFields =>
	review?.host ? { host: review.host, available: review.available } : {};

/** The content with its list entry's host once that entry arrives, or undefined when nothing changes.
 * A review a remote opens can mount before its entry reaches the list. */
export function withRemoteEntry<T extends RemoteFields>(content: T, review: ReviewApiSummary | undefined): T | undefined {
	const entry = remoteEntry(review);
	if (!entry.host || (entry.host === content.host && JSON.stringify(entry.available) === JSON.stringify(content.available))) return undefined;
	return { ...content, ...entry };
}
