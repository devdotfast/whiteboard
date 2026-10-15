import type { ReviewApiSummary } from "../../../common/reviewProtocol.js";

type RemoteFields = Pick<ReviewApiSummary, "host" | "hostState" | "available">;

export const remoteEntry = (review: ReviewApiSummary | undefined, busy = false): RemoteFields =>
	review?.host ? { host: review.host, ...(review.hostState && { hostState: review.hostState }), available: busy && review.hostState === "online" && review.available ? { ...review.available, pending: true } : review.available } : {};

export function withRemoteEntry<T extends RemoteFields>(content: T, review: ReviewApiSummary | undefined, busy = false): T | undefined {
	const entry = remoteEntry(review, busy);
	if (!entry.host || (entry.host === content.host && entry.hostState === content.hostState && JSON.stringify(entry.available) === JSON.stringify(content.available))) return undefined;
	return { ...content, ...entry };
}
