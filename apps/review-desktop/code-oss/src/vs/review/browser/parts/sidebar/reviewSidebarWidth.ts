/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/** The narrowest the sidebar goes when the window controls are no wider. */
export const REVIEW_SIDEBAR_MINIMUM_WIDTH = 170;

/** The space between the last window control and the sidebar's edge. */
const CONTROLS_GAP = 12;

/** The digits a tab's count is given room for, so a count can grow to 999
 * without the minimum moving. */
export const TAB_COUNT_DIGITS = 3;

/**
 * The sidebar's minimum width: wide enough for the window controls over its
 * top row, measured where they end, so they never spill onto the board, and
 * for its tabs row with every label whole.
 */
export function sidebarMinimumWidth(controlsRight: number, sidebarLeft: number, tabsWidth = 0): number {
	return Math.max(REVIEW_SIDEBAR_MINIMUM_WIDTH, Math.ceil(controlsRight - sidebarLeft + CONTROLS_GAP), Math.ceil(tabsWidth));
}

/** The tabs the sidebar can show, which its minimum always holds. */
export const SIDEBAR_TABS = 3;

/**
 * The one width every tab gets, whichever tabs a board shows: the widest
 * label, each with its count at `TAB_COUNT_DIGITS` digits, and padding.
 */
export function sidebarTabWidth(labels: readonly number[], padding: number): number {
	return Math.ceil(Math.max(0, ...labels) + 2 * padding);
}

/** The tabs row with all its tabs: their widths, the gaps, and padding. */
export function tabsRowWidth(tabWidth: number, gap: number, rowPadding: number, tabs = SIDEBAR_TABS): number {
	return tabWidth * tabs + gap * Math.max(0, tabs - 1) + 2 * rowPadding;
}

/**
 * A measurement taken once and kept until `stale()`: the tabs' widths change
 * only with the zoom or the fonts, not at every layout, and measuring forces
 * one. A measurement that comes back undefined is not kept.
 */
export function measuredOnce<T>(measure: () => T | undefined): { get(): T | undefined; stale(): void } {
	let kept: { value: T } | undefined;
	return {
		get: () => {
			if (kept) return kept.value;
			const value = measure();
			if (value !== undefined) kept = { value };
			return value;
		},
		stale: () => { kept = undefined; },
	};
}
