/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from "../../../../base/browser/dom.js";
import { renderIcon } from "../../../../base/browser/ui/iconLabel/iconLabels.js";
import { onDidChangeFullscreen, onDidChangeZoomLevel } from "../../../../base/browser/browser.js";
import { Codicon } from "../../../../base/common/codicons.js";
import { Emitter, Event } from "../../../../base/common/event.js";
import { timeout } from "../../../../base/common/async.js";
import { Disposable, type IDisposable, MutableDisposable, toDisposable } from "../../../../base/common/lifecycle.js";
import { localize, localize2 } from "../../../../nls.js";
import { Action2, registerAction2 } from "../../../../platform/actions/common/actions.js";
import { IInstantiationService, type ServicesAccessor, createDecorator } from "../../../../platform/instantiation/common/instantiation.js";
import { IHoverService } from "../../../../platform/hover/browser/hover.js";
import { ICommandService } from "../../../../platform/commands/common/commands.js";
import { IKeybindingService } from "../../../../platform/keybinding/common/keybinding.js";
import { ILogService } from "../../../../platform/log/common/log.js";
import { IStorageService, StorageScope, StorageTarget } from "../../../../platform/storage/common/storage.js";
import { IThemeService } from "../../../../platform/theme/common/themeService.js";
import { Part } from "../../../../workbench/browser/part.js";
import type { EditorInput } from "../../../../workbench/common/editor/editorInput.js";
import { IEditorService } from "../../../../workbench/services/editor/common/editorService.js";
import { IWorkbenchLayoutService, Parts } from "../../../../workbench/services/layout/browser/layoutService.js";
import { REVIEW_CHROME_HEIGHT } from "../../../common/reviewChrome.js";
import { REVIEW_SIDEBAR_MINIMUM_WIDTH, TAB_COUNT_DIGITS, measuredOnce, sidebarMinimumWidth, sidebarTabWidth, tabsRowWidth } from "./reviewSidebarWidth.js";
import type {
	ReviewAskState,
	ReviewProjectThreads,
	ReviewThreadsFilter,
	ReviewSidebarLenses,
	ReviewSidebarSectionHandle,
	ReviewSidebarSectionProps,
	ReviewSidebarState,
	ReviewSurfaceEvent,
} from "../../../common/reviewProtocol.js";
import { ReviewApiClient } from "../../../common/reviewProtocol.js";
import { IReviewApiCatalogService } from "../../../services/reviewApiCatalogService.js";
import { IReviewCanvasEditorTabsService } from "../../../services/reviewCanvasEditorTabsService.js";
import { IReviewDesktopConnectionService } from "../../../services/reviewDesktopConnectionService.js";

import "../../media/review.css";
import { loadReviewCanvasAssets } from "../canvas/reviewCanvasAssets.js";
import { ReviewCanvasEditorInput } from "../canvas/reviewCanvasEditorInput.js";
import { ReviewTooltip } from "../../reviewTooltip.js";
import { type ReviewSidebarPaneId, ReviewSidebarTabs } from "./reviewSidebarTabs.js";
import { REVIEW_SIDEBAR_TAB_COMMANDS } from "../../../contrib/tabs/reviewWindowKeys.js";
import { REVIEW_NEW_WHITEBOARD_COMMAND_ID } from "../../../common/reviewNewWhiteboard.js";

/** Whether a thread started on the board or edited it. */
function onBoard(thread: ReviewProjectThreads["threads"][number], reviewId: string): boolean {
	return thread.anchor.board.reviewId === reviewId || thread.edited.some((board) => board.reviewId === reviewId);
}

/** The board in a tab, when the tab is a board. */
function boardOf(input: EditorInput | undefined): string | undefined {
	return input instanceof ReviewCanvasEditorInput && input.target.kind === "api" ? input.target.reviewId : undefined;
}

/** A collapsible group inside the Changes pane. */
interface ReviewSidebarGroup {
	readonly element: HTMLElement;
	readonly header: HTMLButtonElement;
	readonly chevron: HTMLElement;
	readonly count: HTMLElement;
	readonly body: HTMLElement;
	collapsed: boolean;
}

interface ReviewSidebarPane {
	readonly id: ReviewSidebarPaneId;
	readonly tab: HTMLButtonElement;
	readonly count: HTMLElement;
	readonly element: HTMLElement;
	/** Shown only while the labels are folded away. */
	readonly tooltip: ReviewTooltip;
}

/** Where a diff view puts its changed-files tree in the Files group. */
export interface ReviewSidebarFileTreeHost extends IDisposable {
	readonly element: HTMLElement;
	/** Hides the tree while another view's tree stands in for it. */
	setHidden(hidden: boolean): void;
}

type ReviewSidebarIcon = readonly { tag: "path" | "rect"; attrs: Record<string, string> }[];

/** The tab icons: 16px strokes. */
export const REVIEW_SIDEBAR_TAB_ICONS: Record<ReviewSidebarPaneId, ReviewSidebarIcon> = {
	whiteboard: [
		{ tag: "rect", attrs: { x: "2.5", y: "5", width: "9", height: "8", rx: "1.5" } },
		{ tag: "path", attrs: { d: "M5 5 V4 Q5 2.5 6.5 2.5 H12 Q13.5 2.5 13.5 4 V9.5 Q13.5 11 12 11 H11.5" } },
	],
	threads: [{ tag: "path", attrs: { d: "M4 3 H12 Q13.5 3 13.5 4.5 V9.5 Q13.5 11 12 11 H7.5 L4.5 13.5 V11 H4 Q2.5 11 2.5 9.5 V4.5 Q2.5 3 4 3 Z" } }],
	diff: [{ tag: "path", attrs: { d: "M8 1.75 V10.25 M3.75 6 H12.25 M3.75 13 H12.25" } }],
};

/** The tabs in order; `noun` names what a tab counts, in the rail's
 * tooltips. */
export const REVIEW_SIDEBAR_PANES: readonly { id: ReviewSidebarPaneId; title: string; command: string; noun?: string }[] = [
	{ id: "whiteboard", title: localize("review.sidebar.whiteboard", "Whiteboard"), command: REVIEW_SIDEBAR_TAB_COMMANDS[0] },
	{ id: "diff", title: localize("review.sidebar.diff", "Diff"), command: REVIEW_SIDEBAR_TAB_COMMANDS[1], noun: "file" },
	{ id: "threads", title: localize("review.sidebar.threads", "Threads"), command: REVIEW_SIDEBAR_TAB_COMMANDS[2], noun: "thread" },
];

/** A tab's name and count, as its tooltip and accessible name say it:
 * "Diff · 140 files". */
function paneSummary(id: ReviewSidebarPaneId, count: string): string {
	const { title, noun } = REVIEW_SIDEBAR_PANES.find((pane) => pane.id === id)!;
	return count && noun ? `${title} · ${count} ${noun}${count === "1" ? "" : "s"}` : title;
}

/** The collapsed sidebar's width. KEEP IN SYNC WITH `.review-sidebar-rail`. */
const REVIEW_SIDEBAR_RAIL_WIDTH = 52;

/** Whether Threads lists this board's threads or the project's, per window. */
const REVIEW_SIDEBAR_THREADS_FILTER_KEY = "review.sidebar.threadsFilter";

/** The stored Threads filter; This board when none was picked. */
function threadsFilterOf(stored: string | undefined): ReviewThreadsFilter {
	return stored === "project" || stored === "all" ? stored : "board";
}

/** The Threads tab's mark: a dot, or a spinner while an agent answers. */
function threadsBadge(): HTMLElement {
	const namespace = "http://www.w3.org/2000/svg";
	const badge = $("span.review-sidebar-tab-badge.review-sidebar-tab-badge-threads");
	const spinner = document.createElementNS(namespace, "svg");
	spinner.setAttribute("width", "11");
	spinner.setAttribute("height", "11");
	spinner.setAttribute("viewBox", "0 0 11 11");
	spinner.setAttribute("aria-hidden", "true");
	spinner.classList.add("review-sidebar-tab-spinner");
	const track = document.createElementNS(namespace, "circle");
	track.setAttribute("cx", "5.5");
	track.setAttribute("cy", "5.5");
	track.setAttribute("r", "3.75");
	track.classList.add("review-sidebar-tab-spinner-track");
	const arc = document.createElementNS(namespace, "path");
	arc.setAttribute("d", "M5.5 1.75 A3.75 3.75 0 0 1 9.25 5.5");
	arc.classList.add("review-sidebar-tab-spinner-arc");
	spinner.append(track, arc);
	badge.append(spinner);
	badge.hidden = true;
	return badge;
}

function svgIcon(icon: ReviewSidebarIcon, size: number): SVGSVGElement {
	const namespace = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(namespace, "svg");
	svg.setAttribute("width", String(size));
	svg.setAttribute("height", String(size));
	svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("review-sidebar-icon");
	for (const { tag, attrs } of icon) {
		const element = document.createElementNS(namespace, tag);
		for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
		svg.appendChild(element);
	}
	return svg;
}

/**
 * The sidebar beside a board tab: tab icons under the window controls, then
 * one pane at full height. The panes mount lists from the canvas bundle;
 * Changes also holds the Diff view's file tree. The Diff view picks Changes.
 */
export class ReviewSidebarPart extends Part {
	/** Kept wide enough for the window controls over the top row; the
	 * sash stops there. */
	private fitWidth = REVIEW_SIDEBAR_MINIMUM_WIDTH;
	private tabRow: HTMLElement | undefined;

	override get minimumWidth(): number {
		return this.fitWidth;
	}

	override readonly maximumWidth = 480;
	override readonly minimumHeight = 0;
	override readonly maximumHeight = Number.POSITIVE_INFINITY;

	/** Dragging the sash past the snap threshold collapses the leaf; the
	 * parts service records that as the user closing it. */
	readonly snap = true;

	private readonly panes: ReviewSidebarPane[] = [];
	private readonly lit = new ReviewSidebarTabs((id) => this.offers(id));
	private recentBody: HTMLElement | undefined;
	private whiteboardsBody: HTMLElement | undefined;
	private familyBody: HTMLElement | undefined;
	private commitPicker: HTMLElement | undefined;
	private threadsBody: HTMLElement | undefined;
	private threadsFilter: ReviewThreadsFilter;
	/** Each board's project threads, as the server last sent them. */
	private readonly threads = new Map<string, ReviewProjectThreads>();
	/** The thread each board's Ask shows. */
	private readonly askThreads = new Map<string, readonly string[]>();
	private readonly following = this._register(new MutableDisposable());
	private remaining: HTMLElement | undefined;
	private lenses: ReviewSidebarGroup | undefined;
	private files: ReviewSidebarGroup | undefined;
	private readonly handles = new Map<ReviewSidebarSectionProps["section"], ReviewSidebarSectionHandle>();
	private reviewId: string | undefined;
	private state: ReviewSidebarState = { view: "review" };
	/** Each open board's last report, so switching tabs shows it at once. */
	private readonly states = new Map<string, ReviewSidebarState>();
	/** What each open board's Diff view last reported for Lenses. */
	private readonly lensReports = new Map<string, ReviewSidebarLenses>();
	/** Each board's file trees, kept while its tab is in the background so
	 * switching back shows them without rebuilding the diff. */
	private readonly fileTrees = new Map<string, HTMLElement>();
	private filesNote: HTMLElement | undefined;
	private rendering: Promise<void> = Promise.resolve();
	private readonly _onDidChangeTabs = this._register(new Emitter<void>());
	/** A tab was picked, shown, hidden, or recounted. */
	readonly onDidChangeTabs = this._onDidChangeTabs.event;
	private readonly _onDidChangeBoard = this._register(new Emitter<void>());
	/** The sidebar shows another board. */
	readonly onDidChangeBoard = this._onDidChangeBoard.event;

	constructor(
		private readonly emitSurfaceEvent: (event: ReviewSurfaceEvent) => void,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storage: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
		@IReviewCanvasEditorTabsService private readonly tabs: IReviewCanvasEditorTabsService,
		@IReviewApiCatalogService private readonly catalog: IReviewApiCatalogService,
		@ILogService private readonly logService: ILogService,
		@IHoverService private readonly hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super(Parts.REVIEW_SIDEBAR_PART, { hasTitle: false, borderWidth: () => 0 }, themeService, storage, layoutService);
		this.threadsFilter = threadsFilterOf(storage.get(REVIEW_SIDEBAR_THREADS_FILTER_KEY, StorageScope.WORKSPACE));
		// Whiteboard lists the catalog Home already keeps current.
		this._register(catalog.onDidChange(() => this.render()));
		// The "+" names the new-whiteboard shortcut as bound now.
		this._register(keybindingService.onDidUpdateKeybindings(() => this.render()));
		void catalog.initialize().catch((error) => logService.warn("[Whiteboard] Sidebar catalog failed:", error));
	}

	override layout(width: number, height: number, top: number, left: number): void {
		super.layout(width, height, top, left);
		this.fitControls();
		this.foldTabs(width);
	}

	/** Narrower than the labelled tabs need, they fold to icons and counts.
	 * The labelled width is measured once, apart from the layout, so the
	 * choice follows the sidebar's width alone and can't flip back on
	 * itself. */
	private foldTabs(width: number): void {
		const folded = width < this.tabsRow.get().labelled;
		if (this.tabRow?.classList.contains("folded") === folded) return;
		this.tabRow?.classList.toggle("folded", folded);
		this.describeTabs();
	}

	/** Each tab's accessible name, its full label and count whether or not
	 * the label shows, and its tooltip while folded. */
	private describeTabs(): void {
		const folded = this.tabRow?.classList.contains("folded") ?? false;
		for (const { id, tab, count, tooltip } of this.panes) {
			const summary = paneSummary(id, count.textContent ?? "");
			tab.setAttribute("aria-label", summary);
			const { command } = REVIEW_SIDEBAR_PANES.find((pane) => pane.id === id)!;
			const shortcut = this.shortcut(command);
			tooltip.content = folded ? { label: summary, ...(shortcut && { shortcut }) } : undefined;
		}
	}

	/** Measures where the window controls end and how wide the tabs are,
	 * and widens the minimum to hold both, as the zoom changes their size. */
	private fitControls(): void {
		const controls = this.layoutService.mainContainer.querySelector(".part.titlebar .titlebar-left");
		if (!controls || !this.element) return;
		const width = sidebarMinimumWidth(controls.getBoundingClientRect().right, this.element.getBoundingClientRect().left, this.tabsRow.get().folded);
		if (width === this.fitWidth) return;
		this.fitWidth = width;
		this._onDidChange.fire(undefined);
	}

	/** The tabs row's width, measured once; again when the zoom or the fonts
	 * change. */
	private readonly tabsRow = measuredOnce(() => this.tabsWidth());

	/** Sizes every labelled tab alike, hidden ones included, and returns
	 * the row's width with all of them labelled, and with all of them folded
	 * to an icon and count. Each is measured in a hidden copy of the row,
	 * with its count at full width. */
	private tabsWidth(): { labelled: number; folded: number } {
		const row = this.tabRow;
		const first = this.panes[0]?.tab;
		if (!row || !first) return { labelled: 0, folded: 0 };
		const probe = $(".review-sidebar-tabs-probe", { "aria-hidden": "true" });
		const foldedProbe = $(".review-sidebar-tabs-probe.folded", { "aria-hidden": "true" });
		const tab = (noun: string | undefined, title?: string) => {
			const label = $("span.review-sidebar-tab-label");
			if (title) label.append($("span.review-sidebar-tab-title", undefined, title));
			if (noun) label.append($("span.review-sidebar-tab-count", undefined, "9".repeat(TAB_COUNT_DIGITS)));
			const icon = $("span.review-sidebar-tab-icon");
			icon.append(svgIcon(REVIEW_SIDEBAR_TAB_ICONS.whiteboard, 16));
			return $("span.review-sidebar-tab", undefined, icon, label);
		};
		const labels = REVIEW_SIDEBAR_PANES.map(({ title, noun }) => {
			const labelled = tab(noun, title);
			probe.append(labelled);
			foldedProbe.append(tab(noun));
			return labelled.querySelector(".review-sidebar-tab-label")!;
		});
		row.append(probe, foldedProbe);
		const widths = labels.map((label) => label.getBoundingClientRect().width);
		const foldedWidth = Math.ceil(Math.max(0, ...[...foldedProbe.children].map((child) => child.getBoundingClientRect().width)));
		probe.remove();
		foldedProbe.remove();
		const width = sidebarTabWidth(widths, parseFloat(getComputedStyle(first).paddingLeft) || 0);
		row.style.setProperty("--review-sidebar-tab-width", `${width}px`);
		const style = getComputedStyle(row);
		const gap = parseFloat(style.columnGap) || 0;
		const padding = parseFloat(style.paddingLeft) || 0;
		return { labelled: tabsRowWidth(width, gap, padding), folded: tabsRowWidth(foldedWidth, gap, padding) };
	}

	override create(parent: HTMLElement): void {
		this.element = parent;
		super.create(parent);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		parent.style.setProperty("--review-chrome-height", `${REVIEW_CHROME_HEIGHT}px`);
		// Reserve the top row for the macOS traffic lights.
		parent.appendChild($(".review-explorer-chrome-spacer"));

		const tabRow = this.tabRow = $(".review-sidebar-tabs", { role: "tablist" });
		const panes = $(".review-sidebar-panes");
		parent.append(tabRow, panes);

		for (const { id, title, command } of REVIEW_SIDEBAR_PANES) {
			// An icon over its label; the count, faint, after the label.
			const tab = $("button.review-sidebar-tab", { role: "tab" }) as HTMLButtonElement;
			tab.type = "button";
			const icon = $("span.review-sidebar-tab-icon");
			icon.append(svgIcon(REVIEW_SIDEBAR_TAB_ICONS[id], 16));
			if (id === "whiteboard") icon.append($("span.review-sidebar-tab-badge"));
			if (id === "threads") icon.append(threadsBadge());
			const count = $("span.review-sidebar-tab-count");
			const label = $("span.review-sidebar-tab-label");
			label.append($("span.review-sidebar-tab-title", undefined, title), count);
			tab.append(icon, label);
			tabRow.appendChild(tab);
			// While its label shows, no tooltip: its shortcut is read out
			// instead. Folded to its icon, it has one.
			this._register(this.describeShortcut(tab, command));
			const tooltip = this._register(new ReviewTooltip(this.hoverService, tab));
			const element = $(`.review-sidebar-pane.review-sidebar-pane-${id}`, { role: "tabpanel" });
			panes.appendChild(element);
			this.panes.push({ id, tab, count, element, tooltip });
			this._register(addDisposableListener(tab, "click", () => this.pick(id)));
		}

		// A count or a tab that comes or goes moves the minimum.
		this._register(this.onDidChangeTabs(() => this.fitControls()));

		// The tabs are measured once the row exists, and again only when the
		// zoom or the fonts change their size.
		this.tabsRow.stale();
		const remeasure = () => {
			this.tabsRow.stale();
			this.fitControls();
			if (this.element) this.foldTabs(this.element.getBoundingClientRect().width);
		};
		this._register(onDidChangeZoomLevel(() => requestAnimationFrame(remeasure)));
		this._register(addDisposableListener(parent.ownerDocument.fonts, "loadingdone", remeasure));

		const header = (pane: HTMLElement, title: string) => {
			const row = $(".review-sidebar-pane-header");
			row.append($("span.review-sidebar-section-title", undefined, title));
			pane.appendChild(row);
			return row;
		};

		// Search, then This board, then Recent, scrolling as one.
		const whiteboards = this.pane("whiteboard");
		const stack = $(".review-sidebar-pane-body.review-sidebar-stack");
		this.whiteboardsBody = $(".review-sidebar-stack-body");
		stack.appendChild(this.whiteboardsBody);
		this.familyBody = $(".review-sidebar-stack-body.review-sidebar-family");
		stack.appendChild(this.familyBody);
		// Recent comes last.
		this.recentBody = $(".review-sidebar-stack-body.review-sidebar-recent");
		stack.appendChild(this.recentBody);
		whiteboards.appendChild(stack);

		const threads = this.pane("threads");
		header(threads, localize("review.sidebar.threads", "Threads"));
		this.threadsBody = $(".review-sidebar-pane-body");
		threads.appendChild(this.threadsBody);

		const changes = this.pane("diff");
		const changesHeader = header(changes, localize("review.sidebar.changes", "Changes"));
		this.remaining = $(".review-sidebar-remaining");
		changesHeader.append($("span.review-sidebar-section-spacer"), this.remaining);
		// Which commits the diff shows, over its Lenses and Files.
		this.commitPicker = $(".review-sidebar-commit-picker");
		changes.appendChild(this.commitPicker);
		const groups = $(".review-sidebar-pane-body.review-sidebar-groups");
		changes.appendChild(groups);
		this.lenses = this.group(groups, "lenses", localize("review.sidebar.lenses", "Lenses"));
		this.files = this.group(groups, "files", localize("review.sidebar.files", "Files"));
		// Untracked files are left out of the review; the note says so.
		this.filesNote = $(".review-sidebar-files-note");
		this.filesNote.title = localize("review.sidebar.untrackedTitle", "Untracked files are not part of the review. git add -N a file to include it.");
		this.files.body.appendChild(this.filesNote);

		this.applyPane();
		return parent;
	}

	/** Gives a screen reader the shortcut a command is bound to now, after
	 * any rebind. */
	private describeShortcut(target: HTMLElement, command: string): IDisposable {
		const describe = () => {
			const shortcut = this.keybindingService.lookupKeybinding(command)?.getAriaLabel();
			if (shortcut) target.setAttribute("aria-description", shortcut);
			else target.removeAttribute("aria-description");
		};
		describe();
		return this.keybindingService.onDidUpdateKeybindings(describe);
	}

	private shortcut(command: string): string | undefined {
		return this.keybindingService.lookupKeybinding(command)?.getLabel() ?? undefined;
	}

	private pane(id: ReviewSidebarPaneId): HTMLElement {
		return this.panes.find((pane) => pane.id === id)!.element;
	}

	private group(parent: HTMLElement, id: "lenses" | "files", title: string): ReviewSidebarGroup {
		const header = $("button.review-sidebar-section-header") as HTMLButtonElement;
		header.type = "button";
		const chevron = renderIcon(Codicon.chevronDown);
		const count = $("span.review-sidebar-section-count");
		header.append(chevron, $("span.review-sidebar-section-title", undefined, title), count);
		const body = $(".review-sidebar-section-body");
		const element = $(`.review-sidebar-section.review-sidebar-section-${id}`);
		element.append(header, body);
		parent.appendChild(element);
		const group: ReviewSidebarGroup = { element, header, chevron, count, body, collapsed: false };
		this._register(addDisposableListener(header, "click", () => {
			group.collapsed = !group.collapsed;
			this.applyCollapse(group);
		}));
		this.applyCollapse(group);
		return group;
	}

	private applyCollapse(group: ReviewSidebarGroup): void {
		group.header.setAttribute("aria-expanded", String(!group.collapsed));
		group.body.hidden = group.collapsed;
		group.element.classList.toggle("collapsed", group.collapsed);
		group.chevron.classList.toggle("codicon-chevron-down", !group.collapsed);
		group.chevron.classList.toggle("codicon-chevron-right", group.collapsed);
	}

	/** A click on a tab: Whiteboard and Diff show their view as well as
	 * their pane; Threads leaves the view where it is. */
	pick(id: ReviewSidebarPaneId): void {
		const view = this.lit.pick(id, this.state.view);
		if (view && this.reviewId) this.emitSurfaceEvent({ event: "showReviewView", view, reviewId: this.reviewId });
		this.applyPane();
	}

	/** Whether the board has the tab: Diff needs a change. */
	private offers(id: ReviewSidebarPaneId): boolean {
		if (id === "diff") return this.state.lenses !== undefined || this.state.files !== undefined;
		return true;
	}

	private applyPane(): void {
		for (const pane of this.panes) {
			const selected = pane.id === this.lit.active;
			pane.tab.classList.toggle("active", selected);
			pane.tab.setAttribute("aria-selected", String(selected));
			pane.tab.hidden = !this.offers(pane.id);
			pane.element.hidden = !selected;
		}
		this._onDidChangeTabs.fire();
	}

	/** The tabs as the collapsed rail draws them. */
	tabStates(): { id: ReviewSidebarPaneId; active: boolean; offered: boolean; count: string; badge: HTMLElement | undefined }[] {
		return this.panes.map((pane) => ({
			id: pane.id,
			active: pane.id === this.lit.active,
			offered: this.offers(pane.id),
			count: pane.count.textContent ?? "",
			badge: pane.tab.querySelector<HTMLElement>(".review-sidebar-tab-badge") ?? undefined,
		}));
	}

	/** The board the sidebar shows, from the active tab. */
	setBoard(reviewId: string | undefined): void {
		if (reviewId === this.reviewId) return;
		this.reviewId = reviewId;
		// A board not yet reported keeps the last board's frame until its
		// canvas reports, rather than blanking it.
		this.state = (reviewId && this.states.get(reviewId)) || this.state;
		this.follow(reviewId);
		this.showFileTrees();
		this.render();
		this._onDidChangeBoard.fire();
	}

	/** What the board's canvas reports: the view on screen and its counts. */
	report(reviewId: string | undefined, state: ReviewSidebarState): void {
		if (!reviewId) return;
		// Counts still loading keep what is shown: the board's last counts,
		// else the frame it inherited, so Diff and its headers don't flicker.
		if (state.countsPending) {
			const shown = this.states.get(reviewId) ?? (reviewId === this.reviewId ? this.state : undefined);
			state = { ...state, lenses: state.lenses ?? shown?.lenses, files: state.files ?? shown?.files };
		}
		this.states.set(reviewId, state);
		if (reviewId !== this.reviewId) return;
		this.state = state;
		this.render();
	}

	/** The threads the board's Ask shows, marked in Threads. The filter
	 * stays what the reader picked. */
	reportAsk(reviewId: string | undefined, state: ReviewAskState): void {
		if (!reviewId) return;
		this.askThreads.set(reviewId, state.threadIds);
		if (reviewId === this.reviewId) this.render();
	}

	private setThreadsFilter(filter: ReviewThreadsFilter): void {
		this.threadsFilter = filter;
		this.storage.store(REVIEW_SIDEBAR_THREADS_FILTER_KEY, filter, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this.render();
	}

	/** Follows the board's project threads while the sidebar shows it. */
	private follow(reviewId: string | undefined): void {
		this.following.clear();
		if (!reviewId) return;
		const abort = new AbortController();
		this.following.value = toDisposable(() => abort.abort());
		const accept = (update: ReviewProjectThreads) => {
			this.threads.set(reviewId, update);
			if (reviewId === this.reviewId) this.render();
		};
		void (async () => {
			while (!abort.signal.aborted) {
				try {
					const client = new ReviewApiClient(await this.connection.getConnection());
					const response = await client.response(`/${encodeURIComponent(reviewId)}/ask/threads?watch`, { signal: abort.signal });
					const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
					let pending = "";
					for (let read = await reader.read(); !read.done; read = await reader.read()) {
						pending += read.value;
						for (let end = pending.indexOf("\n"); end !== -1; end = pending.indexOf("\n")) {
							// SAFETY: the server sends ReviewProjectThreads lines on this route.
							accept(JSON.parse(pending.slice(0, end)) as ReviewProjectThreads);
							pending = pending.slice(end + 1);
						}
					}
				} catch (error) {
					if (abort.signal.aborted) return;
					this.logService.warn("[Whiteboard] Sidebar threads disconnected:", error);
				}
				await timeout(2000);
			}
		})();
	}

	/** What the board's Diff view reports for Lenses. */
	reportLenses(reviewId: string | undefined, lenses: ReviewSidebarLenses): void {
		if (!reviewId) return;
		this.lensReports.set(reviewId, lenses);
		if (reviewId === this.reviewId) this.render();
	}

	/** Whether this part shows the board. */
	showsBoard(reviewId: string | undefined): boolean {
		return reviewId !== undefined && reviewId === this.reviewId;
	}

	/**
	 * A place in Files for one of the board's diff views to put its file
	 * tree. The view disposes it.
	 */
	fileTreeHost(reviewId: string): ReviewSidebarFileTreeHost {
		let trees = this.fileTrees.get(reviewId);
		if (!trees) {
			trees = $(".review-sidebar-file-trees");
			this.fileTrees.set(reviewId, trees);
		}
		const owner = trees;
		const element = $(".review-sidebar-file-tree");
		owner.appendChild(element);
		this.showFileTrees();
		return {
			element,
			setHidden: (hidden) => { element.hidden = hidden; },
			dispose: () => {
				element.remove();
				if (owner.childElementCount === 0 && this.fileTrees.get(reviewId) === owner) {
					this.fileTrees.delete(reviewId);
					owner.remove();
				}
			},
		};
	}

	/** Puts the shown board's trees in Files, ahead of the untracked note. */
	private showFileTrees(): void {
		const body = this.files?.body;
		if (!body || !this.filesNote) return;
		const trees = this.reviewId ? this.fileTrees.get(this.reviewId) : undefined;
		body.replaceChildren(...(trees ? [trees] : []), this.filesNote);
	}

	/** The view on screen for the board shown. */
	get view(): string {
		return this.state.view;
	}

	private render(): void {
		this.lit.follow(this.state.view);
		this.applyPane();

		const reviewId = this.reviewId;
		const lensReport = reviewId ? this.lensReports.get(reviewId) : undefined;
		if (this.lenses) this.lenses.count.textContent = this.state.lenses === undefined ? "" : String(this.state.lenses);
		if (this.files) {
			const untracked = this.state.files?.untracked ?? 0;
			if (this.filesNote) {
				this.filesNote.hidden = !untracked;
				this.filesNote.textContent = untracked === 1
					? localize("review.sidebar.untrackedOne", "1 untracked file not shown")
					: localize("review.sidebar.untracked", "{0} untracked files not shown", untracked);
			}
			// While a lens filters, show "3 of 10".
			const filtered = lensReport?.active !== undefined ? lensReport.activeFiles : undefined;
			this.files.count.textContent = !this.state.files ? "" : filtered !== undefined
				? localize("review.sidebar.filesOf", "{0} of {1}", filtered, this.state.files.count)
				: String(this.state.files.count);
		}

		const project = reviewId ? this.project(reviewId) : undefined;
		const boardThreads = reviewId ? (this.threads.get(reviewId)?.threads ?? []).filter((thread) => onBoard(thread, reviewId)) : [];
		const counts: Record<ReviewSidebarPaneId, number | undefined> = {
			whiteboard: undefined,
			diff: this.state.files?.count,
			threads: boardThreads.length || undefined,
		};
		for (const pane of this.panes) pane.count.textContent = counts[pane.id] === undefined ? "" : String(counts[pane.id]);
		this.describeTabs();
		// The blue dot: another board in the project changed since last viewed.
		const badge = this.panes.find((pane) => pane.id === "whiteboard")?.tab.querySelector(".review-sidebar-tab-badge");
		if (badge instanceof HTMLElement) badge.hidden = !project?.boards.some((board) => board.changed && board.reviewId !== reviewId);
		// One mark for the project's threads: amber when one needs the reader,
		// else a spinner while one answers, else blue for an answer unseen.
		const threadsBadge = this.panes.find((pane) => pane.id === "threads")?.tab.querySelector(".review-sidebar-tab-badge");
		if (threadsBadge instanceof HTMLElement) {
			const update = reviewId ? this.threads.get(reviewId) : undefined;
			const threads = update?.threads.filter((thread) => thread.projectId === update.project) ?? [];
			const mark = threads.some((thread) => thread.status === "waiting")
				? "waiting"
				: threads.some((thread) => thread.status === "running" || thread.status === "starting")
					? "answering"
					: threads.some((thread) => thread.unread)
						? "unread"
						: undefined;
			threadsBadge.hidden = !mark;
			threadsBadge.dataset.mark = mark ?? "";
		}
		// After the counts and badges, so the rail copies this render's.
		this._onDidChangeTabs.fire();

		this.rendering = this.rendering
			.then(() => this.mountSections())
			.catch((error) => this.logService.warn("[Whiteboard] Sidebar sections failed:", error));
	}

	private async mountSections(): Promise<void> {
		const reviewId = this.reviewId;
		if (!reviewId) return;

		const [assets, connection] = await Promise.all([loadReviewCanvasAssets(), this.connection.getConnection()]);
		if (reviewId !== this.reviewId) return;

		const project = this.project(reviewId);
		const lenses = this.lensReports.get(reviewId);
		const newWhiteboardShortcut = this.shortcut(REVIEW_NEW_WHITEBOARD_COMMAND_ID);
		const props: ReviewSidebarSectionProps = {
			section: "whiteboards",
			connection: { serverUrl: connection.serverUrl, token: connection.token },
			reviewId,
			onOpenBoard: (id) => {
				const title = this.catalog.reviews.find((review) => review.reviewId === id)?.title ?? "Whiteboard";
				void this.tabs.openApiReview(id, title);
			},
			...(project && { project }),
			// Recent spans every project: the catalog Home already keeps.
			recent: [...this.catalog.reviews],
			...(lenses && { lenses }),
			onSelectLens: (lensId) => this.emitSurfaceEvent({ event: "selectLens", reviewId, lensId }),
			onMarkLens: (lensId) => this.emitSurfaceEvent({ event: "markLens", reviewId, lensId }),
			setupTooltip: this.setupTooltip,
			threads: {
				list: this.threads.get(reviewId)?.threads ?? [],
				...(this.threads.get(reviewId)?.project && { project: this.threads.get(reviewId)!.project }),
				filter: this.threadsFilter,
				open: this.askThreads.get(reviewId) ?? [],
			},
			onFilterThreads: (filter) => this.setThreadsFilter(filter),
			onOpenThread: (threadId) => this.emitSurfaceEvent({ event: "openAskThread", reviewId, threadId }),
			...(this.state.commits?.length && {
				commits: {
					list: this.state.commits,
					...(this.state.commit && { selected: this.state.commit }),
					...(this.state.compare && { compare: this.state.compare }),
				},
			}),
			onPickCommit: (commit) => this.emitSurfaceEvent({ event: "pickCommit", reviewId, commit }),
			onNewWhiteboard: () => void this.commandService.executeCommand(REVIEW_NEW_WHITEBOARD_COMMAND_ID),
			...(newWhiteboardShortcut && { newWhiteboardShortcut }),
		};

		const mounts: [ReviewSidebarSectionProps["section"], HTMLElement | undefined][] = [
			["family", this.familyBody],
			["recent", this.recentBody],
			["whiteboards", this.whiteboardsBody],
			["commitPicker", this.commitPicker],
			["threads", this.threadsBody],
			["remaining", this.remaining],
			["lenses", this.lenses?.body],
		];
		for (const [section, element] of mounts) {
			if (!element) continue;
			const handle = this.handles.get(section);
			if (handle) handle.update({ ...props, section });
			else this.handles.set(section, assets.mountReviewSidebarSection(element, { ...props, section }));
		}
	}

	/** The board's project and its boards, from the catalog; undefined until
	 * the catalog has the board. */
	private project(reviewId: string): ReviewSidebarSectionProps["project"] {
		const board = this.catalog.reviews.find((review) => review.reviewId === reviewId);
		if (!board) return undefined;
		const project = board.project ?? null;
		return {
			project,
			boards: project
				? this.catalog.reviews.filter((review) => review.project?.id === project.id && !review.trashedAt)
				: [],
		};
	}

	/** The workbench's tooltip, for the lens counts and truncated names. */
	private readonly setupTooltip = (target: HTMLElement, text: string, options?: { detail?: string }) =>
		new ReviewTooltip(this.hoverService, target, { label: text, ...(options?.detail && { detail: options.detail }) });

	/** The lens list element, where the canvas draws the agent's cursor. */
	lensList(reviewId: string | undefined): HTMLElement | undefined {
		return this.showsBoard(reviewId) ? this.lenses?.body : undefined;
	}

	override dispose(): void {
		for (const handle of this.handles.values()) handle.dispose();
		super.dispose();
	}

	toJSON(): object {
		return { type: Parts.REVIEW_SIDEBAR_PART };
	}
}

export const IReviewSidebarPartsService = createDecorator<IReviewSidebarPartsService>("reviewSidebarPartsService");

export interface IReviewSidebarPartsService {
	readonly _serviceBrand: undefined;

	/** Closes the sidebar when it is open, reopens it when it is closed. A
	 * no-op unless the active tab is a board. */
	toggle(): void;

	/** Clears a sticky close so the sidebar shows beside the active board. */
	show(): void;

	/** A board's canvas reports the view on screen and its counts. */
	report(reviewId: string | undefined, state: ReviewSidebarState): void;

	/** A board's canvas reports the thread its Ask shows. */
	reportAsk(reviewId: string | undefined, state: ReviewAskState): void;

	/** Shows the sidebar on its Threads tab. */
	showThreads(): void;

	/** Picks a tab and its view; Diff and Threads also open a folded
	 * sidebar. */
	showTab(id: ReviewSidebarPaneId): void;

	/** Scroll requests from the sidebar for the board on screen. */
	readonly onDidEmitSurfaceEvent: Event<ReviewSurfaceEvent>;

	/** A board's Diff view reports what Lenses lists. */
	reportLenses(reviewId: string | undefined, lenses: ReviewSidebarLenses): void;

	/** Whether the sidebar shows the board, and when that may change. */
	showsBoard(reviewId: string | undefined): boolean;
	readonly onDidChangeBoard: Event<void>;

	/** A place in Files for a board's diff view to put its file tree. */
	fileTreeHost(reviewId: string): ReviewSidebarFileTreeHost;

	/** The lens list, while the sidebar shows the board. */
	lensList(reviewId: string | undefined): HTMLElement | undefined;
}

/** Set on the workbench while the closed sidebar shows as its rail. */
const REVIEW_SIDEBAR_RAILED_CLASS = "review-sidebar-railed";

/** Set on the workbench while a board is active, so the toggle shows. */
const REVIEW_SIDEBAR_AVAILABLE_CLASS = "review-explorer-available";

/** Remembers a close across reloads. */
const REVIEW_SIDEBAR_USER_CLOSED_KEY = "review.sidebar.userClosed";

/**
 * Creates the sidebar part and decides when it shows: beside a board tab,
 * unless the reader closed it. A close is remembered across reloads.
 */
export class ReviewSidebarParts extends Disposable implements IReviewSidebarPartsService {
	declare readonly _serviceBrand: undefined;

	private readonly part: ReviewSidebarPart;
	private readonly emitter = this._register(new Emitter<ReviewSurfaceEvent>());
	readonly onDidEmitSurfaceEvent = this.emitter.event;

	/** When the board it shows changes, or the part shows or hides. */
	readonly onDidChangeBoard: Event<void>;

	private available = false;
	private userClosed: boolean;
	private applying = false;
	/** The tabs alone, at the window's left edge while the sidebar is
	 * closed beside a board. */
	private readonly rail: HTMLElement;
	private readonly railButtons = new Map<ReviewSidebarPaneId, { button: HTMLButtonElement; tooltip: ReviewTooltip; badge: HTMLElement }>();

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IStorageService private readonly storageService: IStorageService,
		@IHoverService hoverService: IHoverService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super();
		this.part = this._register(
			instantiationService.createInstance(ReviewSidebarPart, (event: ReviewSurfaceEvent) => this.emitter.fire(event)),
		);
		const shownOrHidden = this._register(new Emitter<void>());
		this.onDidChangeBoard = Event.any(this.part.onDidChangeBoard, shownOrHidden.event);
		this.userClosed = this.storageService.getBoolean(REVIEW_SIDEBAR_USER_CLOSED_KEY, StorageScope.WORKSPACE, false);

		this.rail = $(".review-sidebar-rail", { role: "tablist" });
		for (const { id, title } of REVIEW_SIDEBAR_PANES) {
			const button = $("button.review-sidebar-rail-tab", { role: "tab", "aria-label": title }) as HTMLButtonElement;
			button.type = "button";
			const badge = $("span.review-sidebar-rail-badge");
			button.append(svgIcon(REVIEW_SIDEBAR_TAB_ICONS[id], 16), badge);
			this.rail.appendChild(button);
			// Beside the tab: the rail runs up under the window controls.
			const tooltip = this._register(new ReviewTooltip(hoverService, button, { label: title }, "right"));
			this.railButtons.set(id, { button, tooltip, badge });
			// Whiteboard switches the view and keeps the rail; Diff and Threads
			// open the sidebar, for its commits, Files and Lenses, or the list.
			this._register(addDisposableListener(button, "click", () => this.showTab(id)));
		}
		this.layoutService.mainContainer.appendChild(this.rail);
		this._register(toDisposable(() => this.rail.remove()));
		this._register(this.part.onDidChangeTabs(() => this.renderRail()));
		this._register(this.keybindingService.onDidUpdateKeybindings(() => this.renderRail()));
		// The window controls the page bar clears move with the window's
		// size, with the zoom, which resizes them once the title bar lays out,
		// and with full screen, where the traffic lights go away.
		this._register(this.layoutService.onDidLayoutMainContainer(() => this.renderRail()));
		this._register(onDidChangeZoomLevel(() => requestAnimationFrame(() => this.renderRail())));
		this._register(onDidChangeFullscreen(() => this.renderRail()));

		this._register(this.editorService.onDidActiveEditorChange(() => this.update()));
		this._register(
			this.layoutService.onDidChangePartVisibility((event) => {
				if (event.partId !== Parts.REVIEW_SIDEBAR_PART) return;
				shownOrHidden.fire();
				if (this.applying || !this.available) return;
				this.setUserClosed(!event.visible);
			}),
		);
		this.update();
	}

	toggle(): void {
		if (!this.available) return;
		this.setUserClosed(!this.userClosed);
		this.update();
	}

	show(): void {
		this.setUserClosed(false);
		this.update();
	}

	report(reviewId: string | undefined, state: ReviewSidebarState): void {
		this.part.report(reviewId, state);
	}

	reportLenses(reviewId: string | undefined, lenses: ReviewSidebarLenses): void {
		this.part.reportLenses(reviewId, lenses);
	}

	reportAsk(reviewId: string | undefined, state: ReviewAskState): void {
		this.part.reportAsk(reviewId, state);
	}

	showThreads(): void {
		this.showTab("threads");
	}

	showTab(id: ReviewSidebarPaneId): void {
		if (!this.available) return;
		// A rail stays a rail for Whiteboard. Diff's commits, Files and
		// Lenses and the Threads list live in the sidebar, so those open it;
		// only this pick does, and a later close sticks.
		if (id === "diff" || id === "threads") this.show();
		this.part.pick(id);
	}

	/** Whether the board's Files and Lenses belong here rather than in the
	 * Diff view. They do while the sidebar is folded to its rail too: there
	 * the diff takes the width, and the files wait for the sidebar. */
	showsBoard(reviewId: string | undefined): boolean {
		return this.part.showsBoard(reviewId);
	}

	fileTreeHost(reviewId: string): ReviewSidebarFileTreeHost {
		return this.part.fileTreeHost(reviewId);
	}

	lensList(reviewId: string | undefined): HTMLElement | undefined {
		return this.showsBoard(reviewId) ? this.part.lensList(reviewId) : undefined;
	}

	private renderRail(): void {
		const railed = this.available && this.userClosed;
		this.rail.hidden = !railed;
		const main = this.layoutService.mainContainer;
		// The page bar starts past the window controls, which the rail is
		// narrower than.
		const controls = main.querySelector(".part.titlebar .titlebar-left")?.getBoundingClientRect().right ?? 0;
		main.style.setProperty("--review-page-bar-inset", railed ? `${Math.max(0, Math.round(controls) - REVIEW_SIDEBAR_RAIL_WIDTH)}px` : "0px");
		if (!railed) return;
		for (const tab of this.part.tabStates()) {
			const entry = this.railButtons.get(tab.id)!;
			const { command } = REVIEW_SIDEBAR_PANES.find((pane) => pane.id === tab.id)!;
			entry.button.hidden = !tab.offered;
			entry.button.classList.toggle("active", tab.active);
			entry.button.setAttribute("aria-selected", String(tab.active));
			entry.badge.hidden = !tab.badge || tab.badge.hidden;
			entry.badge.dataset.mark = tab.badge?.dataset.mark ?? "";
			const shortcut = this.keybindingService.lookupKeybinding(command)?.getLabel() ?? undefined;
			entry.tooltip.content = { label: paneSummary(tab.id, tab.count), ...(shortcut && { shortcut }) };
		}
	}

	private setUserClosed(userClosed: boolean): void {
		if (this.userClosed === userClosed) return;
		this.userClosed = userClosed;
		this.storageService.store(REVIEW_SIDEBAR_USER_CLOSED_KEY, userClosed, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private update(): void {
		const reviewId = boardOf(this.editorService.activeEditor ?? undefined);
		this.part.setBoard(reviewId);
		this.available = reviewId !== undefined;
		const visible = this.available && !this.userClosed;

		this.layoutService.mainContainer.classList.toggle(REVIEW_SIDEBAR_AVAILABLE_CLASS, this.available);
		this.layoutService.mainContainer.classList.toggle(REVIEW_SIDEBAR_RAILED_CLASS, this.available && this.userClosed);
		this.renderRail();
		this.applying = true;
		try {
			this.layoutService.setPartHidden(!visible, Parts.REVIEW_SIDEBAR_PART);
		} finally {
			this.applying = false;
		}
	}
}

// ⌘1–⌘3 pick the tabs in order; reviewWindowKeys binds them.
for (const { id, title, command } of REVIEW_SIDEBAR_PANES) {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: command,
				title: localize2("review.sidebar.showTab", "Show {0}", title),
				f1: true,
			});
		}

		override run(accessor: ServicesAccessor): void {
			accessor.get(IReviewSidebarPartsService).showTab(id);
		}
	});
}
