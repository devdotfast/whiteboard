/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { boardIconKind, boardTitle, type ReviewApiSummary } from "./reviewProtocol.js";

export const REVIEW_GO_TO_WHITEBOARD_COMMAND_ID = "review.goToWhiteboard";

/** What the ⌘K bar reads of a board. */
export type JumpBoard = Pick<
	ReviewApiSummary,
	| "reviewId"
	| "title"
	| "target"
	| "origin"
	| "pullRequestState"
	| "project"
	| "repositoryName"
	| "repositoryPath"
	| "parentId"
	| "changed"
	| "viewedAt"
	| "createdAt"
	| "trashedAt"
>;

/** A board as one row of the bar: the title is matched with the description. */
export interface JumpRow {
	readonly reviewId: string;
	readonly label: string;
	readonly description: string;
	/** "board" or "code", or the board's PR state. */
	readonly icon: "board" | "code" | NonNullable<ReviewApiSummary["pullRequestState"]>;
	readonly unread: boolean;
}

/** How many boards the bar lists before anything is typed, so its commands
 * stay in view; typing searches them all. */
export const RECENT_BOARD_LIMIT = 12;

const projectKey = (board: JumpBoard) => board.project?.id ?? board.repositoryName;

/** The boards not in Trash, the one seen last first. */
function liveBoards(boards: readonly JumpBoard[]): JumpBoard[] {
	const lastSeen = (board: JumpBoard) => board.viewedAt ?? board.createdAt;
	return boards.filter((board) => !board.trashedAt).sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)));
}

/**
 * Every board the bar can open, in the order it lists them before anything
 * is typed: unread first, then the ones viewed last. The board on screen is
 * left out, so Enter on the first row always goes somewhere.
 */
export function jumpRows(boards: readonly JumpBoard[], current?: string): JumpRow[] {
	const live = liveBoards(boards);
	const byId = new Map(live.map((board) => [board.reviewId, board]));
	// A checkout is named only when its project has boards in another one too.
	const checkouts = new Map<string, Set<string | undefined>>();
	for (const board of live) checkouts.set(projectKey(board), (checkouts.get(projectKey(board)) ?? new Set()).add(board.repositoryPath));

	return live
		.filter((board) => board.reviewId !== current)
		.sort((a, b) => Number(Boolean(b.changed)) - Number(Boolean(a.changed)))
		.map((board) => {
			const pullRequest = board.origin?.pullRequestNumber;
			const parent = board.parentId ? byId.get(board.parentId) : undefined;
			const repository = board.project?.name.split("/").pop() || board.repositoryName;
			const label = boardTitle(board.title);
			const pullRequestTitle = board.origin?.pullRequestTitle;
			const description = [
				(checkouts.get(projectKey(board))?.size ?? 0) > 1 && board.repositoryName !== repository
					? `${repository} (${board.repositoryName})`
					: repository,
				pullRequest &&
				(pullRequestTitle && pullRequestTitle.trim().toLowerCase() !== label.trim().toLowerCase()
					? `#${pullRequest} ${pullRequestTitle}`
					: `#${pullRequest}`),
				board.origin?.branch,
				parent && `in ${boardTitle(parent.title)}`,
			].filter(Boolean).join(" · ");

			return {
				reviewId: board.reviewId,
				label,
				description,
				icon: pullRequest ? (board.pullRequestState ?? "open") : boardIconKind(board.target),
				unread: Boolean(board.changed),
			};
		});
}

/** A pasted GitHub or GitHub Enterprise pull request link. */
export interface PullRequestLink {
	/** owner/repo, as GitHub spells it. */
	readonly slug: string;
	readonly number: number;
	/** The PR's canonical URL, without a tab or query. */
	readonly url: string;
}

/** The PR a pasted link names; undefined for anything else. Any host, as the
 * server takes: its gh sign-in decides whether the PR can be read. */
export function parsePullRequestLink(text: string): PullRequestLink | undefined {
	const match = /^\s*(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)(?:[/?#]\S*)?\s*$/i.exec(text);
	if (!match) return undefined;
	const [, host, owner, repo, number] = match;
	const slug = `${owner}/${repo}`;
	return { slug, number: Number(number), url: `https://${host.toLowerCase()}/${slug}/pull/${number}` };
}

/** Where a pasted PR link leads. */
export type PullRequestDestination =
	| { readonly kind: "open"; readonly reviewId: string; readonly title: string }
	| { readonly kind: "restore"; readonly reviewId: string; readonly title: string }
	| { readonly kind: "create"; readonly repositoryPath: string }
	| { readonly kind: "none" };

/**
 * The PR's own board when one is listed, restored first if it is in Trash:
 * a create would only hand back that board. Else a checkout of the PR's
 * repository to create one in, the one used last first. A checkout belongs
 * to the repository when its project is named for it, as a GitHub remote
 * names it, or when it already holds a board of one of the repository's PRs.
 */
export function pullRequestDestination(link: PullRequestLink, boards: readonly JumpBoard[]): PullRequestDestination {
	const existing = boards
		.filter((board) => board.origin?.pullRequestUrl !== undefined && parsePullRequestLink(board.origin.pullRequestUrl)?.url.toLowerCase() === link.url.toLowerCase())
		.sort((a, b) => Number(Boolean(a.trashedAt)) - Number(Boolean(b.trashedAt)))[0];
	if (existing) return { kind: existing.trashedAt ? "restore" : "open", reviewId: existing.reviewId, title: boardTitle(existing.title) };

	const slug = link.slug.toLowerCase();
	const ofRepository = (board: JumpBoard) =>
		board.project?.name.toLowerCase() === slug ||
		(board.origin?.pullRequestUrl !== undefined && parsePullRequestLink(board.origin.pullRequestUrl)?.slug.toLowerCase() === slug);
	const checkout = liveBoards(boards).find((board) => board.repositoryPath && ofRepository(board))?.repositoryPath;
	return checkout ? { kind: "create", repositoryPath: checkout } : { kind: "none" };
}
