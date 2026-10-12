/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/** How many boards back and forward can return to without reloading. */
export const KEPT_BOARDS = 10;

/** How long a closing window waits for an Untitled board to be let go. */
export const LET_GO_MS = 5000;

/**
 * The boards behind the active one that close: any new board nobody named,
 * so the server discards it, and the oldest past KEPT_BOARDS (the active
 * board counts). `behind` is most recent first.
 */
export function boardsToClose<T>(behind: readonly T[], untitled: (board: T) => boolean): T[] {
	return behind.filter((board, index) => untitled(board) || index >= KEPT_BOARDS - 1);
}

/**
 * A closing window lets go of its Untitled boards: closing a board's editor
 * saves what it holds and releases it, then the server discards it if it is
 * still untouched. Gives up after `timeoutMs` so the window always closes.
 */
export async function letGoOfUntitled(
	boards: readonly string[],
	close: () => Promise<unknown>,
	discard: (reviewId: string) => Promise<unknown>,
	timeoutMs = LET_GO_MS,
): Promise<void> {
	if (!boards.length) return;
	const work = (async () => {
		await close();
		await Promise.all(boards.map((reviewId) => discard(reviewId).catch(() => undefined)));
	})();
	await Promise.race([work, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

/** What `keepOneGroup` needs of the editor groups. */
export interface OneGroupWindow<G> {
	readonly groups: readonly G[];
	readonly activeGroup: G;
	mergeGroup(source: G, target: G): unknown;
}

/**
 * The window shows one board at a time, so it has one editor group: any
 * other group, from a split or a restored layout, is merged into the active
 * one, its boards behind the board on show.
 */
export function keepOneGroup<G>(window: OneGroupWindow<G>): void {
	for (const group of [...window.groups])
		if (group !== window.activeGroup) window.mergeGroup(group, window.activeGroup);
}
