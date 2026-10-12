/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ReviewApiSummary } from "./reviewProtocol.js";

export const REVIEW_NEW_WHITEBOARD_COMMAND_ID = "review.newWhiteboard";

type Board = Pick<ReviewApiSummary, "reviewId" | "project" | "repositoryPath" | "viewedAt" | "createdAt" | "trashedAt">;

/**
 * The checkout a new whiteboard is a plan in: the project of the board open
 * most recently (the active tab first), else of the board viewed last. The
 * board's own checkout when it has one here, else another of the project's.
 * Undefined when no board belongs to a project with a checkout here.
 */
export function newWhiteboardRepositoryPath(reviews: readonly Board[], recentBoardIds: readonly string[]): string | undefined {
	const byId = new Map(reviews.map((review) => [review.reviewId, review]));
	const lastSeen = (review: Board) => review.viewedAt ?? review.createdAt;
	const viewed = reviews.filter((review) => !review.trashedAt).sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)));
	const anchor = [...recentBoardIds.map((id) => byId.get(id)), ...viewed].find((review) => review?.project);
	if (!anchor) return undefined;
	if (anchor.repositoryPath) return anchor.repositoryPath;
	return viewed.find((review) => review.project?.id === anchor.project!.id && review.repositoryPath)?.repositoryPath;
}
