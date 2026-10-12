/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener } from "../../../../base/browser/dom.js";
import { renderIcon } from "../../../../base/browser/ui/iconLabel/iconLabels.js";
import { Codicon } from "../../../../base/common/codicons.js";
import { Emitter, Event } from "../../../../base/common/event.js";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.js";
import { localize } from "../../../../nls.js";
import { IInstantiationService, createDecorator } from "../../../../platform/instantiation/common/instantiation.js";
import { IHoverService } from "../../../../platform/hover/browser/hover.js";
import { ILogService } from "../../../../platform/log/common/log.js";
import { IStorageService, StorageScope, StorageTarget } from "../../../../platform/storage/common/storage.js";
import { IThemeService } from "../../../../platform/theme/common/themeService.js";
import { Part } from "../../../../workbench/browser/part.js";
import type { EditorInput } from "../../../../workbench/common/editor/editorInput.js";
import { IEditorService } from "../../../../workbench/services/editor/common/editorService.js";
import { IWorkbenchLayoutService, Parts } from "../../../../workbench/services/layout/browser/layoutService.js";
import { REVIEW_CHROME_HEIGHT } from "../../../common/reviewChrome.js";
import type {
	ReviewSidebarLenses,
	ReviewSidebarSectionHandle,
	ReviewSidebarSectionProps,
	ReviewSidebarState,
	ReviewSurfaceEvent,
} from "../../../common/reviewProtocol.js";
import { IReviewApiCatalogService } from "../../../services/reviewApiCatalogService.js";
import { IReviewCanvasEditorTabsService } from "../../../services/reviewCanvasEditorTabsService.js";
import { IReviewDesktopConnectionService } from "../../../services/reviewDesktopConnectionService.js";

import "../../media/review.css";
import { loadReviewCanvasAssets } from "../canvas/reviewCanvasAssets.js";
import { ReviewCanvasEditorInput } from "../canvas/reviewCanvasEditorInput.js";
import { ReviewTooltip } from "../../reviewTooltip.js";

/** The board in a tab, when the tab is a board. */
function boardOf(input: EditorInput | undefined): string | undefined {
	return input instanceof ReviewCanvasEditorInput && input.target.kind === "api" ? input.target.reviewId : undefined;
}

/** The panes, picked one at a time by the tab icons under the window
 * controls. */
type ReviewSidebarPaneId = "whiteboards" | "changes";

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
	readonly element: HTMLElement;
}

/** Where a diff view puts its changed-files tree in the Files group. */
export interface ReviewSidebarFileTreeHost extends IDisposable {
	readonly element: HTMLElement;
	/** Hides the tree while another view's tree stands in for it. */
	setHidden(hidden: boolean): void;
}

type ReviewSidebarIcon = readonly { tag: "path" | "rect"; attrs: Record<string, string> }[];

/** The tab icons: 16px strokes. */
const REVIEW_SIDEBAR_TAB_ICONS: Record<ReviewSidebarPaneId, ReviewSidebarIcon> = {
	whiteboards: [
		{ tag: "rect", attrs: { x: "2.5", y: "5", width: "9", height: "8", rx: "1.5" } },
		{ tag: "path", attrs: { d: "M5 5 V4 Q5 2.5 6.5 2.5 H12 Q13.5 2.5 13.5 4 V9.5 Q13.5 11 12 11 H11.5" } },
	],
	changes: [{ tag: "path", attrs: { d: "M8 1.75 V10.25 M3.75 6 H12.25 M3.75 13 H12.25" } }],
};

const REVIEW_SIDEBAR_PANES: readonly { id: ReviewSidebarPaneId; title: string }[] = [
	{ id: "whiteboards", title: localize("review.sidebar.whiteboards", "Whiteboards") },
	{ id: "changes", title: localize("review.sidebar.changes", "Changes") },
];


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
	override readonly minimumWidth = 170;
	override readonly maximumWidth = 480;
	override readonly minimumHeight = 0;
	override readonly maximumHeight = Number.POSITIVE_INFINITY;

	/** Dragging the sash past the snap threshold collapses the leaf; the
	 * parts service records that as the user closing it. */
	readonly snap = true;

	private readonly panes: ReviewSidebarPane[] = [];
	private active: ReviewSidebarPaneId = "whiteboards";
	private contentsHeader: HTMLElement | undefined;
	private contentsBody: HTMLElement | undefined;
	private contentsCount: HTMLElement | undefined;
	private whiteboardsBody: HTMLElement | undefined;
	private whiteboardsCount: HTMLElement | undefined;
	private remaining: HTMLElement | undefined;
	private lenses: ReviewSidebarGroup | undefined;
	private files: ReviewSidebarGroup | undefined;
	private readonly handles = new Map<ReviewSidebarSectionProps["section"], ReviewSidebarSectionHandle>();
	private reviewId: string | undefined;
	private state: ReviewSidebarState = { contents: [], view: "review" };
	/** Each open board's last report, so switching tabs shows it at once. */
	private readonly states = new Map<string, ReviewSidebarState>();
	/** What each open board's Diff view last reported for Lenses. */
	private readonly lensReports = new Map<string, ReviewSidebarLenses>();
	/** Each board's file trees, kept while its tab is in the background so
	 * switching back shows them without rebuilding the diff. */
	private readonly fileTrees = new Map<string, HTMLElement>();
	private filesNote: HTMLElement | undefined;
	/** The view the pane was last picked for; a click holds until it changes. */
	private paneView: string | undefined;
	private rendering: Promise<void> = Promise.resolve();
	private readonly _onDidChangeBoard = this._register(new Emitter<void>());
	/** The sidebar shows another board. */
	readonly onDidChangeBoard = this._onDidChangeBoard.event;

	constructor(
		private readonly emitSurfaceEvent: (event: ReviewSurfaceEvent) => void,
		@IThemeService themeService: IThemeService,
		@IStorageService storage: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
		@IReviewCanvasEditorTabsService private readonly tabs: IReviewCanvasEditorTabsService,
		@IReviewApiCatalogService private readonly catalog: IReviewApiCatalogService,
		@ILogService private readonly logService: ILogService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super(Parts.REVIEW_SIDEBAR_PART, { hasTitle: false, borderWidth: () => 0 }, themeService, storage, layoutService);
		// Whiteboards lists the catalog Home already keeps current.
		this._register(catalog.onDidChange(() => this.render()));
		void catalog.initialize().catch((error) => logService.warn("[Whiteboard] Sidebar catalog failed:", error));
	}

	override create(parent: HTMLElement): void {
		this.element = parent;
		super.create(parent);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		parent.style.setProperty("--review-chrome-height", `${REVIEW_CHROME_HEIGHT}px`);
		// Reserve the top row for the macOS traffic lights.
		parent.appendChild($(".review-explorer-chrome-spacer"));

		const tabRow = $(".review-sidebar-tabs", { role: "tablist" });
		const panes = $(".review-sidebar-panes");
		parent.append(tabRow, panes);

		for (const { id, title } of REVIEW_SIDEBAR_PANES) {
			const tab = $("button.review-sidebar-tab", { role: "tab", title, "aria-label": title }) as HTMLButtonElement;
			tab.type = "button";
			tab.append(svgIcon(REVIEW_SIDEBAR_TAB_ICONS[id], 16));
			if (id === "whiteboards") tab.append($("span.review-sidebar-tab-badge"));
			tabRow.appendChild(tab);
			const element = $(`.review-sidebar-pane.review-sidebar-pane-${id}`, { role: "tabpanel" });
			panes.appendChild(element);
			this.panes.push({ id, tab, element });
			this._register(addDisposableListener(tab, "click", () => this.pick(id)));
		}

		const header = (pane: HTMLElement, title: string) => {
			const row = $(".review-sidebar-pane-header");
			row.append($("span.review-sidebar-section-title", undefined, title));
			pane.appendChild(row);
			return row;
		};

		// Whiteboards, then the board's contents under them, scrolling as one.
		const whiteboards = this.pane("whiteboards");
		const stack = $(".review-sidebar-pane-body.review-sidebar-stack");
		const whiteboardsHeader = header(stack, localize("review.sidebar.whiteboards", "Whiteboards"));
		this.whiteboardsCount = $("span.review-sidebar-section-count");
		whiteboardsHeader.append(this.whiteboardsCount);
		this.whiteboardsBody = $(".review-sidebar-stack-body");
		stack.appendChild(this.whiteboardsBody);
		this.contentsHeader = header(stack, localize("review.sidebar.contents", "Contents"));
		this.contentsHeader.classList.add("review-sidebar-stack-header");
		this.contentsCount = $("span.review-sidebar-section-count");
		this.contentsHeader.append(this.contentsCount);
		this.contentsBody = $(".review-sidebar-stack-body");
		stack.appendChild(this.contentsBody);
		whiteboards.appendChild(stack);

		const changes = this.pane("changes");
		const changesHeader = header(changes, localize("review.sidebar.changes", "Changes"));
		this.remaining = $(".review-sidebar-remaining");
		changesHeader.append($("span.review-sidebar-section-spacer"), this.remaining);
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

	/** A click on a tab: it holds until the view changes. Changes fills from
	 * the Diff view, so outside it the tab opens that view. */
	private pick(id: ReviewSidebarPaneId): void {
		if (id === "changes" && this.state.view !== "diff") {
			if (this.reviewId) this.emitSurfaceEvent({ event: "showReviewView", view: "diff", reviewId: this.reviewId });
			return;
		}
		this.active = id;
		this.applyPane();
	}

	/** Whether the board has a change, and so a Changes tab. */
	private get hasChanges(): boolean {
		return this.state.lenses !== undefined || this.state.files !== undefined;
	}

	private applyPane(): void {
		if (this.active === "changes" && !this.hasChanges) this.active = "whiteboards";
		for (const pane of this.panes) {
			const selected = pane.id === this.active;
			pane.tab.classList.toggle("active", selected);
			pane.tab.setAttribute("aria-selected", String(selected));
			pane.tab.hidden = pane.id === "changes" && !this.hasChanges;
			pane.element.hidden = !selected;
		}
	}

	/** The board the sidebar shows, from the active tab. */
	setBoard(reviewId: string | undefined): void {
		if (reviewId === this.reviewId) return;
		this.reviewId = reviewId;
		// A board not yet reported keeps the last board's frame until its
		// canvas reports, rather than blanking it, but none of its Contents:
		// a heading there would belong to the last board.
		this.state = (reviewId && this.states.get(reviewId)) || { ...this.state, contents: [], activeHeading: undefined };
		this.showFileTrees();
		this.render();
		this._onDidChangeBoard.fire();
	}

	/** What the board's canvas reports: its headings and the view on screen. */
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
		// The view picks the pane when it changes: the Diff view Changes, the
		// Review view the pane last picked there. A click holds until then.
		if (this.state.view !== this.paneView) {
			this.paneView = this.state.view;
			this.active = this.state.view === "diff" ? "changes" : "whiteboards";
		}
		this.applyPane();

		const reviewId = this.reviewId;
		const lensReport = reviewId ? this.lensReports.get(reviewId) : undefined;
		if (this.contentsCount) {
			const headings = this.state.contents.filter((entry) => entry.level === "h2").length;
			this.contentsCount.textContent = headings ? String(headings) : "";
		}
		// A board with no headings has no Contents section.
		const empty = this.state.contents.length === 0;
		if (this.contentsHeader) this.contentsHeader.hidden = empty;
		if (this.contentsBody) this.contentsBody.hidden = empty;
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
		if (this.whiteboardsCount && project) {
			// The count, then the repository name, not the full project path.
			const label = project.project?.name.split("/").at(-1);
			this.whiteboardsCount.textContent = project.project ? `${project.boards.length}${label ? ` · ${label}` : ""}` : "";
		}
		// The blue dot: another board in the project changed since last viewed.
		const badge = this.panes.find((pane) => pane.id === "whiteboards")?.tab.querySelector(".review-sidebar-tab-badge");
		if (badge instanceof HTMLElement) badge.hidden = !project?.boards.some((board) => board.changed && board.reviewId !== reviewId);

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
		const props: ReviewSidebarSectionProps = {
			section: "contents",
			connection: { serverUrl: connection.serverUrl, token: connection.token },
			reviewId,
			contents: this.state.contents,
			...(this.state.activeHeading && { activeHeading: this.state.activeHeading }),
			onOpenBoard: (id, active) => {
				const title = this.catalog.reviews.find((review) => review.reviewId === id)?.title ?? "Whiteboard";
				void this.tabs.openApiReview(id, title, active);
			},
			onOpenHeading: (headingId) => this.emitSurfaceEvent({ event: "revealHeading", reviewId, headingId }),
			...(project && { project }),
			...(lenses && { lenses }),
			onSelectLens: (lensId) => this.emitSurfaceEvent({ event: "selectLens", reviewId, lensId }),
			onMarkLens: (lensId) => this.emitSurfaceEvent({ event: "markLens", reviewId, lensId }),
			setupTooltip: this.setupTooltip,
		};

		const mounts: [ReviewSidebarSectionProps["section"], HTMLElement | undefined][] = [
			["contents", this.contentsBody],
			["whiteboards", this.whiteboardsBody],
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

	/** A board's canvas reports its headings and the view on screen. */
	report(reviewId: string | undefined, state: ReviewSidebarState): void;

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

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.part = this._register(
			instantiationService.createInstance(ReviewSidebarPart, (event: ReviewSurfaceEvent) => this.emitter.fire(event)),
		);
		const shownOrHidden = this._register(new Emitter<void>());
		this.onDidChangeBoard = Event.any(this.part.onDidChangeBoard, shownOrHidden.event);
		this.userClosed = this.storageService.getBoolean(REVIEW_SIDEBAR_USER_CLOSED_KEY, StorageScope.WORKSPACE, false);

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

	/** Whether the board's Files and Lenses are on screen here; a hidden
	 * part leaves them to the Diff view. */
	showsBoard(reviewId: string | undefined): boolean {
		return this.layoutService.isVisible(Parts.REVIEW_SIDEBAR_PART) && this.part.showsBoard(reviewId);
	}

	fileTreeHost(reviewId: string): ReviewSidebarFileTreeHost {
		return this.part.fileTreeHost(reviewId);
	}

	lensList(reviewId: string | undefined): HTMLElement | undefined {
		return this.showsBoard(reviewId) ? this.part.lensList(reviewId) : undefined;
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
		this.applying = true;
		try {
			this.layoutService.setPartHidden(!visible, Parts.REVIEW_SIDEBAR_PART);
		} finally {
			this.applying = false;
		}
	}
}
