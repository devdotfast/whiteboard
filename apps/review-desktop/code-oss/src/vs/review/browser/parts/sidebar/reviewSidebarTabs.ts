/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/** The tabs under the window controls. Whiteboard and Diff pick the main
 * view too; Threads only the pane. Diff picks its commits itself. */
export type ReviewSidebarPaneId = "whiteboard" | "diff" | "threads";

/** The view each tab shows, for the two that own one. */
const TAB_VIEWS: Partial<Record<ReviewSidebarPaneId, "review" | "diff">> = {
	whiteboard: "review",
	diff: "diff",
};

/** The tab that owns a view; Trace and Map show under Whiteboard. */
function tabOfView(view: string): ReviewSidebarPaneId {
	return view === "diff" ? view : "whiteboard";
}

/**
 * Which tab is lit, kept in step with the board's view. The canvas owns the
 * view: a tab asks it to switch, and its report back confirms the tab. A
 * view change lights its tab; Threads holds until the view changes.
 */
export class ReviewSidebarTabs {
	active: ReviewSidebarPaneId = "whiteboard";
	private view: string | undefined;

	/** `offers` says whether the board has a tab: Diff needs a change. */
	constructor(private readonly offers: (id: ReviewSidebarPaneId) => boolean) { }

	/** A tab is picked. Returns the view to ask the canvas for, if any. */
	pick(id: ReviewSidebarPaneId, view: string): "review" | "diff" | undefined {
		if (!this.offers(id)) return undefined;
		this.active = id;
		const wanted = TAB_VIEWS[id];
		return wanted && wanted !== view ? wanted : undefined;
	}

	/** The canvas reports the view on screen. */
	follow(view: string): void {
		if (view !== this.view) {
			this.view = view;
			this.active = tabOfView(view);
		}
		if (!this.offers(this.active)) this.active = "whiteboard";
	}
}
