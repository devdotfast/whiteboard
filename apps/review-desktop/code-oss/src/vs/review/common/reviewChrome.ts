/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The height of the one Review chrome row, in CSS pixels.
 *
 * Review draws the titlebar as an overlay on the editor tab strip, so one
 * height controls three things that must agree: the titlebar part, the macOS
 * window controls, and the editor tab strip. 52px is a 28px tab pill plus 12px
 * of padding above it and 12px below it, and puts the macOS window controls
 * 19px from the window's top and left edges, where Apple's toolbar windows put them.
 *
 * KEEP IN SYNC WITH:
 * - `.review-chrome-overlay` and the pill metrics in
 *   `review/browser/media/review.css`.
 * - `EditorTabsControl.EDITOR_TAB_HEIGHT.review` in
 *   `workbench/browser/parts/editor/editorTabsControl.ts`.
 */
export const REVIEW_CHROME_HEIGHT = 52;
