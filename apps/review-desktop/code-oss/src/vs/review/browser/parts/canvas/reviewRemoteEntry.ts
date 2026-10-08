import type { ReviewApiSummary } from "../../../common/reviewProtocol.js";

type RemoteFields = Pick<ReviewApiSummary, "host" | "available">;

export const remoteEntry = (review: ReviewApiSummary | undefined): RemoteFields =>
	review?.host ? { host: review.host, available: review.available } : {};

export function withRemoteEntry<T extends RemoteFields>(content: T, review: ReviewApiSummary | undefined): T | undefined {
	const entry = remoteEntry(review);
	if (!entry.host || (entry.host === content.host && JSON.stringify(entry.available) === JSON.stringify(content.available))) return undefined;
	return { ...content, ...entry };
}
