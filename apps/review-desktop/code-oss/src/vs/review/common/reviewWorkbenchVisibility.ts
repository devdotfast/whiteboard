/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Review hosts Home, review canvases, files, and diffs in one native editor
 * group. The upstream agent sessions part stays hidden in this layout.
 *
 * `explorer` (the board sidebar) is never persisted. `ReviewSidebarParts`
 * derives it from the active editor on every change, so the layout always
 * starts it hidden and lets that service reassert it once the restored
 * editor is known.
 *
 * A user *closing* the sidebar is a separate matter. That is a decision rather
 * than derived state, so it has to survive the next tab switch and a reload.
 * `ReviewSidebarParts` persists it on its own key (`review.sidebar.userClosed`)
 * and folds it into the derived value. No part visibility is stored here.
 */
export const initialReviewPartVisibility = {
	sidebar: false,
	auxiliaryBar: false,
	editor: true,
	panel: false,
	sessions: false,
	explorer: false,
} as const;
