import type { ReviewApiSummary } from "../../../common/reviewProtocol.js";

type RemoteFields = Pick<ReviewApiSummary, "host" | "hostState" | "available">;

export const remoteEntry = (review: ReviewApiSummary | undefined): RemoteFields =>
	review?.host ? { host: review.host, ...(review.hostState && { hostState: review.hostState }), available: review.available } : {};

export function withRemoteEntry<T extends RemoteFields>(content: T, review: ReviewApiSummary | undefined): T | undefined {
	const entry = remoteEntry(review);
	if (!entry.host || (entry.host === content.host && entry.hostState === content.hostState && JSON.stringify(entry.available) === JSON.stringify(content.available))) return undefined;
	return { ...content, ...entry };
}
