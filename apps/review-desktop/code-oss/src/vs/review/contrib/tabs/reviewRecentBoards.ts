/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/** How long after a press the next one keeps walking the same list. */
export const RECENT_CYCLE_MS = 1500;

interface RecentBoard {
	readonly reviewId: string;
	readonly viewedAt: string | null;
	readonly trashedAt: string | null;
	readonly project?: { readonly id: string };
}

/** The boards of the open board's project opened last, newest first, as
 * the sidebar's Recent lists them, with the open board among them. */
export function recentBoardIds(boards: readonly RecentBoard[], current: string | undefined): string[] {
	const project = boards.find((board) => board.reviewId === current)?.project?.id;
	return boards
		.filter((board) => board.viewedAt && !board.trashedAt && (!project || board.project?.id === project))
		.sort((left, right) => Date.parse(right.viewedAt!) - Date.parse(left.viewedAt!))
		.map((board) => board.reviewId);
}

/**
 * Ctrl+Tab's walk through the boards opened last. The first press goes to
 * the board before this one; each press soon after goes one further, over
 * the list as it stood at the first press, since opening a board moves it
 * to the front. Ctrl+Shift+Tab walks back.
 */
export class RecentCycle {
	private list: readonly string[] = [];
	private index = 0;
	private at = Number.NEGATIVE_INFINITY;

	constructor(private readonly now: () => number = Date.now) { }

	/** The board to open, or undefined when there is no other. */
	step(current: string | undefined, recent: () => readonly string[], direction: 1 | -1): string | undefined {
		const time = this.now();
		if (time - this.at > RECENT_CYCLE_MS || this.list[this.index] !== current) {
			const ids = recent();
			this.list = current && !ids.includes(current) ? [current, ...ids] : ids;
			this.index = current ? Math.max(0, this.list.indexOf(current)) : -1;
		}
		this.at = time;
		if (this.list.length < 2 && current) return undefined;
		this.index = (this.index + direction + this.list.length) % this.list.length;
		return this.list[this.index];
	}
}
