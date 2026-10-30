/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openChildWhiteboard } from "../../reviewChildWhiteboard.js";

import { reviewBottomScrollPadding } from "../../reviewScrollPadding.js";
import { $, addDisposableListener, getWindow, type Dimension } from "../../../../base/browser/dom.js";
import { mainWindow } from "../../../../base/browser/window.js";
import type { IHoverOptions, IHoverWidget } from "../../../../base/browser/ui/hover/hover.js";
import { HoverPosition } from "../../../../base/browser/ui/hover/hoverWidget.js";
import type { CancellationToken } from "../../../../base/common/cancellation.js";
import { Emitter } from "../../../../base/common/event.js";
import { Disposable, DisposableStore, MutableDisposable, toDisposable, type IDisposable } from "../../../../base/common/lifecycle.js";
import { basename } from "../../../../base/common/path.js";
import type { ICursorPositionChangedEvent } from "../../../../editor/common/cursorEvents.js";
import { ICommandService } from "../../../../platform/commands/common/commands.js";
import { ConfigurationTarget, IConfigurationService } from "../../../../platform/configuration/common/configuration.js";
import { TextEditorSelectionSource, type IEditorOptions } from "../../../../platform/editor/common/editor.js";
import { IDialogService, IFileDialogService } from "../../../../platform/dialogs/common/dialogs.js";
import { IContextMenuService, IContextViewService } from "../../../../platform/contextview/browser/contextView.js";
import { IHoverService } from "../../../../platform/hover/browser/hover.js";
import { createDecorator, IInstantiationService } from "../../../../platform/instantiation/common/instantiation.js";
import { ILogService } from "../../../../platform/log/common/log.js";
import { FocusMode } from "../../../../platform/native/common/native.js";
import { INotificationService } from "../../../../platform/notification/common/notification.js";
import { IProductService } from "../../../../platform/product/common/productService.js";
import { IWorkbenchEnvironmentService } from "../../../../workbench/services/environment/common/environmentService.js";
import { IEditorProgressService, LongRunningOperation } from "../../../../platform/progress/common/progress.js";
import { IStorageService, StorageScope } from "../../../../platform/storage/common/storage.js";
import { ITelemetryService } from "../../../../platform/telemetry/common/telemetry.js";
import { ColorScheme } from "../../../../platform/theme/common/theme.js";
import { IThemeService } from "../../../../platform/theme/common/themeService.js";
import { Part } from "../../../../workbench/browser/part.js";
import { EditorPane } from "../../../../workbench/browser/parts/editor/editorPane.js";
import type {
	IEditorControl,
	IEditorOpenContext,
	IEditorPaneSelection,
	IEditorPaneSelectionChangeEvent,
} from "../../../../workbench/common/editor.js";
import { EditorPaneSelectionChangeReason } from "../../../../workbench/common/editor.js";
import type { IEditorGroup } from "../../../../workbench/services/editor/common/editorGroupsService.js";
import { IHostService } from "../../../../workbench/services/host/browser/host.js";
import { IWorkbenchThemeService, type IWorkbenchColorTheme } from "../../../../workbench/services/themes/common/workbenchThemeService.js";
import { importColorThemes } from "../../reviewThemeImport.js";
import { isMacintosh } from "../../../../base/common/platform.js";
import { ILifecycleService, ShutdownReason } from "../../../../workbench/services/lifecycle/common/lifecycle.js";
import { IWorkbenchLayoutService, Parts } from "../../../../workbench/services/layout/browser/layoutService.js";
import {
	DIFF_EDITOR_FONT_SIZE_SETTING,
	DIFF_EDITOR_IGNORE_TRIM_WHITESPACE_SETTING,
	DIFF_EDITOR_WORD_WRAP_SETTING,
	EDITOR_FONT_FAMILY_SETTING,
	EDITOR_FONT_LIGATURES_SETTING,
	EDITOR_FONT_SIZE_SETTING,
	REVIEW_DOCUMENT_FONT_SIZE_SETTING,
	REVIEW_READING_FONT_FAMILY_SETTING,
	REVIEW_READING_FONT_SETTING,
	REVIEW_OPEN_FILES_IN_APPLICATION_SETTING,
	REVIEW_OPEN_FILES_IN_CHOICES,
	REVIEW_OPEN_FILES_IN_SETTING,
	REVIEW_DIFF_COLOR_THEME_SETTING,
	REVIEW_DOCUMENT_WIDTH_SETTING,
	REVIEW_DIAGRAM_FULLSCREEN_ON_CLICK_SETTING,
	REVIEW_KEYMAP_SETTING,
	REVIEW_READY_NOTIFICATION_SETTING,
	REVIEW_SHOW_RELEASE_NOTES_SETTING,
	REVIEW_SOFTWARE_MAP_SETTING,
	REVIEW_TELEMETRY_SETTING,
} from "../../../common/reviewConfigurationDefaults.js";
import { REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID } from "../../../common/reviewReleaseNotes.js";
import { ReviewApiClient, type ReviewApiSummary, resolveReviewSourceView, reviewSourceAnchor, type ReviewSourceView, type ReviewSourceSelection } from "../../../common/reviewProtocol.js";
import type {
	ReviewCanvasBridge,
	ReviewCanvasContent,
	ReviewCanvasDiagnostic,
	ReviewCanvasHandle,
	ReviewCanvasHomeHost,
	ReviewCanvasInstallActions,
	ReviewCanvasInstallContent,
	ReviewCanvasNewWhiteboardRequest,
	ReviewCanvasOnboarding,
	ReviewAppearance,
	ReviewCanvasSettingsContent,
	ReviewColorTheme,
	ReviewColorThemeKind,
	ReviewCanvasSetupActions,
	ReviewCanvasWelcomeHost,
	ReviewCliInstallStatus,
	ReviewDiffFileWire,
	ReviewDiffViewFactory,
	ReviewDiffViewHandle,
	ReviewOpenFilesIn,
	ReviewOpenFilesInChoice,
	ReviewDocumentWidthChoice,
	ReviewKeymapChoice,
	ReviewReadyNotificationChoice,
	ReviewRemoteHostActions,
	ReviewCanvasSettings,
	ReviewSurfaceEvent,
	ReviewTheme,
	ReviewVerbResponse,
} from "../../../common/reviewProtocol.js";
import {
	parseReviewVerbRequest,
	REVIEW_CANVAS_RESUME_EVENT,
} from "../../../common/reviewProtocol.js";
import { IReviewVerbsService } from "../../../contrib/verbs/reviewVerbs.js";
import { vetoStoppingAskAgents } from "../../reviewAskShutdown.js";
import { notifyOpenFailure } from "./reviewHostFailure.js";
import { confirmReviewDeletion, type ReviewDeleteListedBoard, type ReviewDeleteNamed } from "../../reviewDeleteConfirmation.js";
import { showReviewNotification } from "../../reviewNotification.js";
import { showReviewCanvasMenu } from "../../reviewCanvasMenu.js";
import { ReviewTooltip } from "../../reviewTooltip.js";
import { IReviewApiCatalogService, REVIEW_HAS_PUBLISHED_BOARD } from "../../../services/reviewApiCatalogService.js";
import { IReviewApiSourceService } from "../../../services/reviewApiSourceService.js";
import { IReviewCanvasEditorTabsService } from "../../../services/reviewCanvasEditorTabsService.js";
import { IReviewDesktopConnectionService } from "../../../services/reviewDesktopConnectionService.js";
import { IReviewRemoteHostsService } from "../../../services/remote/reviewRemoteHosts.js";
import { ReviewDiffViewService } from "../../../services/reviewDiffViewService.js";
import {
	ReviewEmbeddedEditorSelection,
	reviewEmbeddedSelectionFromOptions,
} from "../../../services/reviewEmbeddedNavigation.js";
import { ReviewEmbeddedEditors } from "../../../services/reviewEmbeddedEditors.js";
import { homeViewFromOptions, ReviewHomeSelection } from "../../../services/reviewHomeNavigation.js";
import { IReviewTelemetryService } from "../../../services/reviewTelemetryService.js";

import "../../media/review.css";
import { ReviewSessionTelemetry } from "../../reviewSessionTelemetry.js";
import { type ReviewCanvasAssetsModule, loadReviewCanvasAssets } from "./reviewCanvasAssets.js";
import { ReviewCanvasEditorInput } from "./reviewCanvasEditorInput.js";
import { remoteEntry, withRemoteEntry } from "./reviewRemoteEntry.js";
import { reviewRemoteHostsSettings } from "../../reviewRemoteHostsSettings.js";
import { IReviewSidebarPartsService } from "../sidebar/reviewSidebarPart.js";
import { IReviewAskPartsService } from "../ask/reviewAskPart.js";

interface ReviewCanvasLoadLifecycle {
	ready(): void;
	reportDiagnostic(diagnostic: ReviewCanvasDiagnostic): void;
}

type ReviewCanvasState = "home" | "connecting" | "active" | "completed" | "error";
type PendingBoardEvent = Extract<ReviewSurfaceEvent, { event: "revealBlock" | "showReviewView" }> & { reviewId: string };

const APPEARANCE_SETTINGS = {
	diagramFullscreenOnClick: { key: REVIEW_DIAGRAM_FULLSCREEN_ON_CLICK_SETTING, setting: "diagram_fullscreen_on_click" },
	documentFontSize: { key: REVIEW_DOCUMENT_FONT_SIZE_SETTING, setting: "document_font_size" },
	readingFont: { key: REVIEW_READING_FONT_SETTING, setting: "reading_font" },
	readingFontFamily: { key: REVIEW_READING_FONT_FAMILY_SETTING, setting: "reading_font_family" },
	codeFontSize: { key: EDITOR_FONT_SIZE_SETTING, setting: "code_font_size" },
	codeFontFamily: { key: EDITOR_FONT_FAMILY_SETTING, setting: "code_font_family" },
	fontLigatures: { key: EDITOR_FONT_LIGATURES_SETTING, setting: "font_ligatures" },
	diffFontSize: { key: DIFF_EDITOR_FONT_SIZE_SETTING, setting: "diff_font_size" },
	diffWordWrap: { key: DIFF_EDITOR_WORD_WRAP_SETTING, setting: "diff_word_wrap" },
	diffIgnoreWhitespace: { key: DIFF_EDITOR_IGNORE_TRIM_WHITESPACE_SETTING, setting: "diff_ignore_whitespace" },
} as const satisfies Record<keyof ReviewAppearance, { key: string; setting: string }>;

const requestReviewApi: typeof fetch = (url, init) => fetch(url, init);

function embeddedSelectionChangeReason(event: ICursorPositionChangedEvent): EditorPaneSelectionChangeReason {
	switch (event.source) {
		case TextEditorSelectionSource.PROGRAMMATIC:
			return EditorPaneSelectionChangeReason.PROGRAMMATIC;
		case TextEditorSelectionSource.NAVIGATION:
			return EditorPaneSelectionChangeReason.NAVIGATION;
		case TextEditorSelectionSource.JUMP:
			return EditorPaneSelectionChangeReason.JUMP;
		default:
			return EditorPaneSelectionChangeReason.USER;
	}
}

export class ReviewCanvasEditorPane extends EditorPane {
	private homeView: "active" | "trash" = "active";
	private renderHome: (() => Promise<void>) | undefined;
	/** Sent with Home's next render only. */
	private newWhiteboardRequest: ReviewCanvasNewWhiteboardRequest | undefined;
	static readonly ID = ReviewCanvasEditorInput.EDITOR_ID;

	private readonly canvas = this._register(new MutableDisposable<ReviewCanvasHandle>());
	private readonly canvasMenu = this._register(new MutableDisposable<IDisposable>());
	private readonly surfaceEvents = this._register(new Emitter<ReviewSurfaceEvent>());
	private readonly _onDidChangeSelection = this._register(new Emitter<IEditorPaneSelectionChangeEvent>());
	readonly onDidChangeSelection = this._onDidChangeSelection.event;
	private readonly embeddedSelectionListeners = this._register(new MutableDisposable<DisposableStore>());
	private readonly themeEvents = this._register(new Emitter<ReviewTheme>());
	private container: HTMLElement | null = null;
	private canvasMount: HTMLElement | null = null;
	private targetDocument: Document | null = null;
	private apiContent: Extract<ReviewCanvasContent, { kind: "api" }> | undefined;
	private pendingReveal: { event: PendingBoardEvent; at: number } | undefined;
	private loadGeneration = 0;
	private openingGeneration: number | undefined;
	private readonly refreshProgress: LongRunningOperation;
	private renderedInput: ReviewCanvasEditorInput | undefined;
	private readyInput: ReviewCanvasEditorInput | undefined;
	private readonly modelSubscription = this._register(new MutableDisposable());
	private readonly inlineEditors: ReviewEmbeddedEditors;
	private readonly diffViews: ReviewDiffViewService;
	private readonly sessionTelemetry: ReviewSessionTelemetry;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchThemeService private readonly reviewThemeService: IWorkbenchThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironment: IWorkbenchEnvironmentService,
		@IReviewDesktopConnectionService
		private readonly desktopConnection: IReviewDesktopConnectionService,
		@IReviewApiSourceService private readonly apiSource: IReviewApiSourceService,
		@IReviewApiCatalogService private readonly apiCatalog: IReviewApiCatalogService,
		@IReviewRemoteHostsService private readonly remoteHosts: IReviewRemoteHostsService,
		@IReviewVerbsService private readonly verbs: IReviewVerbsService,
		@IReviewSidebarPartsService private readonly sidebar: IReviewSidebarPartsService,
		@IReviewAskPartsService private readonly askParts: IReviewAskPartsService,
		@IReviewCanvasEditorTabsService
		private readonly tabsService: IReviewCanvasEditorTabsService,
		@IInstantiationService
		private readonly reviewInstantiationService: IInstantiationService,
		@IHostService private readonly hostService: IHostService,
		@IWorkbenchLayoutService
		private readonly layoutService: IWorkbenchLayoutService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService
		private readonly configurationService: IConfigurationService,
		@IReviewTelemetryService
		private readonly reviewTelemetryService: IReviewTelemetryService,
		@ILogService private readonly logService: ILogService,
		@IHoverService private readonly hoverService: IHoverService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IDialogService private readonly dialogService: IDialogService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorProgressService editorProgressService: IEditorProgressService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super(ReviewCanvasEditorPane.ID, group, telemetryService, reviewThemeService, storageService);
		this.sessionTelemetry = new ReviewSessionTelemetry((name, properties, context) =>
			this.reviewTelemetryService.capture(name, properties, undefined, context),
		);
		// A clean quit ends the open session before the server would reconcile it as abnormal.
		this._register(lifecycleService.onWillShutdown(() => this.sessionTelemetry.end("app_quit")));
		// Quitting stops the review server and the agents answering in Ask; the
		// reviewer chooses. Elsewhere than macOS, closing the last window quits.
		// A reload leaves them running, to reopen.
		this._register(
			lifecycleService.onBeforeShutdown((event) => {
				const action =
					event.reason === ShutdownReason.QUIT
						? "Quit"
						: event.reason === ShutdownReason.CLOSE && !isMacintosh
							? "Close"
							: undefined;
				if (!action) return;
				event.veto(
					this.desktopConnection
						.workingAskAgents()
						.catch(() => [])
						.then((agents) => vetoStoppingAskAgents(this.dialogService, agents, action)),
					"review.askAgentsWorking",
				);
			}),
		);
		this._register(toDisposable(() => this.sessionTelemetry.end("closed")));
		this._register(toDisposable(() => this.askParts.release(this)));
		// ⌥⌘B: the canvas on screen in the main window puts its column away
		// or brings it back.
		this._register(
			this.askParts.onDidRequestToggle((owner) => {
				const reviewId = this.apiContent?.reviewId;
				if (owner === this && reviewId && this.targetDocument === mainWindow.document)
					this.surfaceEvents.fire({ event: "toggleAskColumn", reviewId });
			}),
		);
		let catalog = this.apiCatalog.reviews;
		this._register(this.apiCatalog.onDidChange(() => {
			const previous = catalog;
			catalog = this.apiCatalog.reviews;
			this.sessionTelemetry.catalogChanged(previous, catalog);
			this.updateRemoteEntry();
		}));
		this._register(this.remoteHosts.onDidChangeBusy(() => this.updateRemoteEntry()));
		this.inlineEditors = this._register(reviewInstantiationService.createInstance(ReviewEmbeddedEditors));
		this.refreshProgress = this._register(new LongRunningOperation(editorProgressService));
		this.diffViews = this._register(
			reviewInstantiationService.createInstance(ReviewDiffViewService, this.inlineEditors),
		);
		// Pass sidebar events on to the board this pane shows.
		this._register(
			this.sidebar.onDidEmitSurfaceEvent((event) => {
				// Every sidebar event names its board; the tabs' showReviewView too.
				if ("reviewId" in event && event.reviewId === this.apiContent?.reviewId) this.surfaceEvents.fire(event);
			}),
		);
		this._register(
			verbs.onDidEmitSurfaceEvent((event) => {
				if (event.event === "revealBlock") return this.pend(event);
				if (event.event === "showReviewView" && event.reviewId) return this.pend({ ...event, reviewId: event.reviewId });
				if (
					event.event === "editorSelectionChanged" &&
					event.reviewId !== this.apiContent?.reviewId
				)
					return;
				this.surfaceEvents.fire(event);
			}),
		);
		this._register(
			verbs.onDidRequestCanvasFocus(() => {
				this.canvas.value?.focus();
				void this.hostService.focus(this.targetDocument?.defaultView ?? window);
			}),
		);
		this._register(
			this.inlineEditors.onDidChangeActiveEditor(() => {
				this._onDidChangeControl.fire();
				this.bindEmbeddedSelectionControl();
			}),
		);
		this._register(
			reviewThemeService.onDidColorThemeChange(() => {
				const theme = this.colorScheme();
				this.themeEvents.fire(theme);
				this.surfaceEvents.fire({ event: "themeChanged", theme });
			}),
		);
		this._register(desktopConnection.onDidFail((error) => void this.renderFailure(error)));
		this._register(
			configurationService.onDidChangeConfiguration((event) => {
				if (
					!event.affectsConfiguration(REVIEW_SOFTWARE_MAP_SETTING) &&
					!event.affectsConfiguration(REVIEW_DOCUMENT_WIDTH_SETTING) &&
					!event.affectsConfiguration(REVIEW_DIAGRAM_FULLSCREEN_ON_CLICK_SETTING)
				)
					return;
				if (this.apiContent) {
					this.apiContent = { ...this.apiContent, settings: this.canvasSettings() };
					this.canvas.value?.update(this.apiContent);
					return;
				}
			}),
		);
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.classList.add("review-canvas-part");
		this.targetDocument = parent.ownerDocument;
		parent.ownerDocument.title = "Whiteboard";
		parent.ownerDocument.body.dataset["reviewCanvasMode"] = "renderer";
		const outer = $(".content.review-canvas-container");
		this.container = $(".review-canvas-host");
		this.container.tabIndex = -1;
		this.canvasMount = $(".review-canvas-surface");
		this.canvasMount.style.setProperty("--review-bottom-scroll-padding", `${reviewBottomScrollPadding}px`);
		this.container.appendChild(this.canvasMount);
		outer.append(this.container);
		parent.appendChild(outer);
		// Inline peek editors promise fixedOverflowWidgets; their hover and
		// definition widgets must be parented outside .review-canvas-root,
		// whose container-query containment re-anchors and clips
		// position: fixed descendants — but inside .monaco-workbench, where
		// the --vscode-* theme variables that style hover widgets are scoped.
		// One shared host serves every peek in this pane.
		const overflowWidgets = $(".review-overflow-widgets.monaco-editor");
		this.layoutService.getContainer(getWindow(parent)).appendChild(overflowWidgets);
		this._register(toDisposable(() => overflowWidgets.remove()));
		this.diffViews.setOverflowWidgetsDomNode(overflowWidgets);
		this.desktopConnection.attachControl(async (value) => {
			const request = parseReviewVerbRequest(value);
			if (request.name === "authoringCapabilities") {
				return { ok: true, result: { softwareMapEnabled: this.currentSoftwareMapEnabled() } };
			}
			if (request.name === "openApiReview") {
				const response = await this.verbs.dispatch(request);
				return response.ok ? { ok: true, result: { softwareMapEnabled: this.currentSoftwareMapEnabled() } } : response;
			}
			if (request.name === "focusWindow") {
				await this.hostService.focus(this.targetDocument?.defaultView ?? window, { mode: FocusMode.Force });
				return { ok: true };
			}
			return this.verbs.dispatch(request);
		});
		void this.desktopConnection.initialize().catch((error) => this.renderError(error));
	}

	override async setInput(
		input: ReviewCanvasEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		const generation = ++this.loadGeneration;
		this.canvasMenu.clear();
		this.refreshProgress.stop();
		this.openingGeneration = generation;
		try {
			await this.setReviewInput(input, options, context, token, generation);
		} finally {
			if (this.openingGeneration === generation) {
				this.openingGeneration = undefined;
			}
		}
	}

	private async setReviewInput(
		input: ReviewCanvasEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
		generation: number,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		// The new input replaces whatever review this pane showed; an api target starts its own session below.
		this.sessionTelemetry.end("closed");
		this.restoreEmbeddedSelection(options);
		try {
			await this.desktopConnection.initialize();
			if (input.target.kind === "api") {
				const { reviewId } = input.target;
				await this.apiCatalog.initialize();
				if (generation !== this.loadGeneration || token.isCancellationRequested) return;
				if (this.apiCatalog.reviews.find(review => review.reviewId === reviewId)?.trashedAt) {
					throw new Error("This whiteboard is in Trash. Restore it from Home before opening it.");
				}
				// Marking the board viewed never holds up drawing it.
				void this.apiCatalog.attention(reviewId, "view").catch(error =>
					this.logService.warn("[Whiteboard] Could not mark the whiteboard viewed:", error),
				);
			}
		} catch (error) {
			if (generation === this.loadGeneration && !token.isCancellationRequested) {
				await this.renderError(error, generation);
			}
			return;
		}
		if (generation !== this.loadGeneration || token.isCancellationRequested) {
			return;
		}
		if (input.target.kind === "api" && this.readyInput === input && this.renderedInput === input) {
			// clearInput ended the session when this review was hidden; the mounted canvas is already ready.
			this.sessionTelemetry.start(input.target.reviewId);
			this.sessionTelemetry.resumed();
			this.canvasMount?.dispatchEvent(new globalThis.Event(REVIEW_CANVAS_RESUME_EVENT));
			return;
		}
		if (input.target.kind === "api-source") {
			// The Source placeholder replaces the mount, so the reuse shortcuts
			// above must not treat the previous review as still rendered.
			this.renderedInput = input;
			this.readyInput = undefined;
			this.setCanvasState("home");
			await this.render({ kind: "source" }, generation);
			return;
		}
		if (!(await this.resetCanvasForGeneration(generation))) {
			return;
		}
		this.modelSubscription.clear();
		if (input.target.kind === "api") {
			try {
				const { reviewId } = input.target;
				// The catalog names the board's project, whose boards share the
				// threads on screen; a failed list only costs that.
				const [connection, assets] = await Promise.all([
					this.desktopConnection.getConnection(),
					this.loadAssets(),
					this.apiCatalog.initialize().catch(() => undefined),
				]);
				if (generation !== this.loadGeneration || token.isCancellationRequested) return;
				this.renderedInput = input;
				this.setCanvasState("active", reviewId);
				this.sessionTelemetry.start(reviewId);
				let sourceSelection: ReviewSourceSelection = { reviewId, kind: "current" };
				let sourceView: ReviewSourceView = resolveReviewSourceView({ reviewId, version: 0, pins: {} });
				const source = this.apiSource.canvas(() => sourceView, this.inlineEditors, this.diffViews);
				await this.render(
					{
						kind: "api",
						reviewId,
						...remoteEntry(...this.catalogEntry(reviewId)),
						projectId: this.apiCatalog.reviews.find((review) => review.reviewId === reviewId)?.project?.id,
						settings: this.canvasSettings(),
						bridge: {
							...source,
							diffView: this.withSidebarFileTree(reviewId, source.diffView),
							...this.sharedBridge(generation, () => {
								this.readyInput = input;
								this.sessionTelemetry.presented();
							}),
							appSessionId: connection.appSessionId,
							wasmUrl: assets.reviewWasmUrl,
							appVersion: this.productService.reviewVersion ?? this.productService.version,
							remoteHosts: this.remoteHostActions(),
							setTitle: (title) => input.setApiTitle(title),
							setSourceView: (selection, next) => {
								sourceSelection = selection;
								sourceView = next;
								source.openStructuralComparison();
							},
							openSource: (source, range) => this.apiSource.open(source, range),
							request: (path, init) => {
								const headers = new Headers(init?.headers);
								if (connection.token) headers.set("x-review-token", connection.token);
								return requestReviewApi(`${connection.serverUrl}${path}`, { ...init, headers });
							},
							beacon: (path, body) => void requestReviewApi(
								`${connection.serverUrl}/reviews-api/${encodeURIComponent(reviewId)}${path}`,
								{ method: "POST", keepalive: true, headers: { "content-type": "application/json", "x-review-token": connection.token }, body },
							).catch(() => undefined),
							post: async (request) => {
								if (request.name === "openSourceTree") {
									return this.openSource(() => this.tabsService.openApiSource(sourceSelection, input.getName()));
								}
								if (request.name === "reveal") {
									const { args } = request;
									return this.openSource(() => this.apiSource.open(
										{ view: reviewSourceAnchor(sourceView, args.pins), file: args.path, side: args.side ?? "head" },
										{ startLine: args.startLine, endLine: args.endLine },
									));
								}
								if (request.name === "openDiff") {
									const { path } = request.args;
									return this.openSource(() => this.apiSource.openDiff(sourceView, path));
								}
								return this.verbs.dispatch(request);
							},
						},
					},
					generation,
					assets,
				);
			} catch (error) {
				if (generation === this.loadGeneration) {
					this.sessionTelemetry.end("closed");
					await this.renderError(error, generation);
				}
			}
			return;
		}
		if (input.target.kind === "home") {
			this.homeView = homeViewFromOptions(options) ?? this.homeView;
			this.renderedInput = input;
			this.setCanvasState("home");
			try {
				await this.apiCatalog.initialize();
			} catch (error) {
				// A server that couldn't start, in its own words: a failed
				// upgrade names the copy to go back to.
				if (generation === this.loadGeneration) await this.renderError(error, generation);
				return;
			}
			let emptyStateVisible = false;
			/* The empty-list render suspends on the install fetch below, while
			   the list render has no await at all. The sequence number keeps a
			   suspended empty render from resuming after a later list render
			   and overwriting it with a stale snapshot. */
			let renderSeq = 0;
			/* Made once for this input: every render passes the same host, so
			   the canvas can depend on its members across list changes. */
			const host: ReviewCanvasHomeHost = {
				navigate: view => {
					if (this.homeView === view) return;
					this.homeView = view;
					void renderHome();
					this._onDidChangeSelection.fire({ reason: EditorPaneSelectionChangeReason.NAVIGATION });
				},
				openSettings: () => { void this.tabsService.openSettings(true); },
				openSetup: () => { void this.tabsService.openWelcome(true); },
				openReview: (uuid) => {
					this.reviewTelemetryService.capture("review_opened", {
						via: "home",
					});
					const api = this.apiCatalog.reviews.find((review) => review.reviewId === uuid);
					if (api) void this.tabsService.openApiReview(uuid, api.title);
				},
				trashReview: (uuid) => {
					this.reviewTelemetryService.capture("review_deleted", { via: "home" });
					return this.apiCatalog.trashReview(uuid);
				},
				markReviewRead: (uuid) => this.apiCatalog.attention(uuid, "view"),
				deleteReview: (uuid) => {
					this.reviewTelemetryService.capture("review_deleted", { via: "home" });
					return this.apiCatalog.deleteReview(uuid);
				},
				restoreReview: (uuid) => {
					this.reviewTelemetryService.capture("review_restored", { via: "home" });
					return this.apiCatalog.lifecycle(uuid, "active");
				},
				remoteHosts: this.remoteHostActions(),
				openSourceTree: (uuid) => {
					const api = this.apiCatalog.reviews.find((review) => review.reviewId === uuid);
					if (api) {
						void this.tabsService.openApiSource({ reviewId: api.reviewId, kind: "current" }, api.title).catch(error => this.notifyOpenFailure(error));
					}
				},
				install: this.installActions(),
				setupActions: this.setupActions(),
				createChildWhiteboard: (parentId) => openChildWhiteboard(this.apiCatalog, this.tabsService, parentId),
				createWhiteboard: async (repositoryPath) => {
					const reviewId = await this.apiCatalog.createReview(repositoryPath);
					// Unnamed: the tab reads "Untitled" until a title is typed.
					await this.tabsService.openApiReview(reviewId, "");
				},
			};
			const renderHome = async () => {
				const seq = ++renderSeq;
				const reviews = this.apiCatalog.reviews;
				// Home shows Welcome when no session is listed.
				const isEmpty = reviews.length === 0;
				// Small catalogs can show setup progress on Home.
				const installStatus = reviews.length < 5 ? await this.resolveInstallStatus() : undefined;
				if (seq !== renderSeq) return;
				const newWhiteboard = this.newWhiteboardRequest;
				this.newWhiteboardRequest = undefined;
				if (isEmpty && !emptyStateVisible) {
					this.reviewTelemetryService.capture("home_empty_state_viewed");
				}
				emptyStateVisible = isEmpty;
				return this.render(
					{
						kind: "home",
						data: {
							view: this.homeView,
							reviews,
							installStatus,
							onboarding: installStatus ? this.resolveOnboarding(installStatus) : undefined,
							newWhiteboard,
						},
						host,
					},
					generation,
				);
			};
			this.renderHome = renderHome;
			// Home stays live while it is the rendered input: a deletion or a
			// newly published review re-renders the list. render() drops stale
			// generations once another input starts loading.
			const subscriptions = new DisposableStore();
			subscriptions.add(this.desktopConnection.onDidChangeLists(() => void renderHome()));
			subscriptions.add(this.apiCatalog.onDidChange(() => void renderHome()));
			this.modelSubscription.value = subscriptions;
			await renderHome();
			return;
		}
		if (input.target.kind === "welcome") {
			this.renderedInput = input;
			this.setCanvasState("home");
			/* Same stale-resume guard as Home: the install fetch suspends, and
			   a later list event must win over an earlier suspended render. */
			let renderSeq = 0;
			const host: ReviewCanvasWelcomeHost = {
				install: this.installActions(),
				setupActions: this.setupActions(),
				close: () => void this.group.closeEditor(input),
			};
			const renderWelcome = async () => {
				const seq = ++renderSeq;
				const installStatus = await this.resolveInstallStatus();
				if (seq !== renderSeq) return;
				return this.render(
					{
						kind: "welcome",
						data: {
							installStatus,
							onboarding: installStatus ? this.resolveOnboarding(installStatus) : undefined,
						},
						host,
					},
					generation,
				);
			};
			// The last step completes when a review publishes, which can happen
			// while this tab sits open.
			this.modelSubscription.value = this.desktopConnection.onDidChangeLists(() => void renderWelcome());
			await renderWelcome();
			return;
		}
		if (input.target.kind === "settings") {
			this.renderedInput = input;
			this.setCanvasState("home");
			const [settings, install] = await Promise.all([this.resolveSettingsContent(), this.resolveInstallContent()]);
			await this.render({ kind: "settings", settings: { ...settings, install } }, generation);
			return;
		}
		if (input.target.kind === "release-notes") {
			this.renderedInput = input;
			this.setCanvasState("home");
			await this.render({
				kind: "release-notes",
				releaseNotes: {
					version: input.target.version,
					showAfterUpdate: this.currentShowReleaseNotes(),
					setShowAfterUpdate: (enabled) => this.setShowReleaseNotes(enabled),
				},
			}, generation);
			return;
		}
	}

	private notifyOpenFailure(error: unknown): void {
		notifyOpenFailure(this.notificationService, (alias) => this.desktopConnection.retryRemoteHost(alias), error);
	}

	/** Answers the canvas instead of rejecting, once the failure is shown. */
	private async openSource(open: () => Promise<void>): Promise<ReviewVerbResponse> {
		try {
			await open();
			return { ok: true };
		} catch (error) {
			this.notifyOpenFailure(error);
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}
	}

	private cachedRemoteHostActions: ReviewRemoteHostActions | undefined;

	/* One object for the pane's life, like `setupActions`: the canvas keys
	   effects on it. */
	private catalogEntry(reviewId: string) {
		const review = this.apiCatalog.reviews.find((entry) => entry.reviewId === reviewId);
		return [review, !!review?.host && this.remoteHosts.isBusy(review.host)] as const;
	}

	private updateRemoteEntry(): void {
		const content = this.apiContent;
		const updated = content && withRemoteEntry(content, ...this.catalogEntry(content.reviewId));
		if (updated) {
			this.apiContent = updated;
			this.canvas.value?.update(updated);
		}
	}

	private remoteHostActions(): ReviewRemoteHostActions {
		return this.cachedRemoteHostActions ??= {
			states: () => this.desktopConnection.readRemoteHosts(),
			retry: (alias) => this.desktopConnection.retryRemoteHost(alias),
			install: (alias) => this.desktopConnection.installRemoteHost(alias),
			openSettings: async () => {
				await this.tabsService.openSettings(true);
			},
		};
	}

	async refreshComparison(): Promise<void> {
		if (!(this.input instanceof ReviewCanvasEditorInput) || this.input.target.kind !== "api") return;
		this.readyInput = undefined;
		await this.group.openEditor(this.input, { forceReload: true, preserveFocus: true });
	}

	override async clearInput(): Promise<void> {
		this.renderHome = undefined;
		this.canvasMenu.clear();
		// Keep apiContent with the mounted canvas so resuming it preserves its review identity.
		// render() replaces both when another input is shown.
		this.refreshProgress.stop();
		this.sessionTelemetry.end("closed");
		await super.clearInput();
	}

	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);
		this.askParts.setShown(this, visible);
		if (!visible) {
			this.canvasMenu.clear();
			this.refreshProgress.stop();
		}
	}

	override focus(): void {
		this.canvas.value?.focus();
	}

	showFind(): boolean {
		const editor = this.inlineEditors.activeCodeEditor;
		let seed: string | undefined;
		if (editor?.hasTextFocus()) {
			const model = editor.getModel();
			const selection = editor.getSelection();
			if (model && selection && !selection.isEmpty()) {
				seed = model.getValueInRange(selection);
			}
		}
		return this.canvas.value?.showFind(seed) ?? false;
	}

	navigateFind(delta: 1 | -1): boolean {
		return this.canvas.value?.navigateFind(delta) ?? false;
	}

	diffFiles(): Promise<readonly ReviewDiffFileWire[]> | undefined {
		return this.canvas.value?.diffFiles();
	}

	/** False when this pane is not Home. */
	newWhiteboard(request: ReviewCanvasNewWhiteboardRequest): boolean {
		if (!this.renderHome || !(this.input instanceof ReviewCanvasEditorInput) || this.input.target.kind !== "home") return false;
		if (this.homeView !== "active") {
			this.homeView = "active";
			this._onDidChangeSelection.fire({ reason: EditorPaneSelectionChangeReason.NAVIGATION });
		}
		this.newWhiteboardRequest = request;
		void this.renderHome();
		return true;
	}

	showFeedback(): void {
		this.canvas.value?.showFeedback();
	}

	revealDiffFile(path: string): void {
		this.canvas.value?.revealDiffFile(path);
	}

	override getControl(): IEditorControl | undefined {
		return this.inlineEditors;
	}

	override setOptions(options: IEditorOptions | undefined): void {
		super.setOptions(options);
		const homeView = homeViewFromOptions(options);
		if (this.input instanceof ReviewCanvasEditorInput && this.input.target.kind === "home" && homeView && homeView !== this.homeView) {
			this.homeView = homeView;
			void this.renderHome?.();
		}
		this.restoreEmbeddedSelection(options);
	}

	getSelection(): IEditorPaneSelection | undefined {
		if (this.input instanceof ReviewCanvasEditorInput && this.input.target.kind === "home") return new ReviewHomeSelection(this.homeView);
		const editor = this.inlineEditors.selectionCodeEditor;
		const position = editor?.getPosition();
		const model = editor?.getModel();
		if (!editor || !position || !model) return undefined;
		const domNode = editor.getDomNode();
		const view = domNode?.closest(".review-files-editor") ? "diff" : "review";
		const section = domNode?.closest<HTMLElement>("[data-review-section]")?.dataset["reviewSection"];
		return new ReviewEmbeddedEditorSelection(editor, {
			view,
			path: model.uri.path.slice(1),
			side: new URLSearchParams(model.uri.query).get("side") === "base" ? "base" : "head",
			lineNumber: position.lineNumber,
			column: position.column,
			section,
		});
	}

	private bindEmbeddedSelectionControl(): void {
		const editor = this.inlineEditors.activeCodeEditor;
		if (!editor) {
			this.embeddedSelectionListeners.clear();
			return;
		}
		const store = new DisposableStore();
		store.add(
			editor.onDidFocusEditorText(() => {
				this._onDidChangeSelection.fire({
					reason: EditorPaneSelectionChangeReason.USER,
				});
			}),
		);
		store.add(
			editor.onDidChangeCursorPosition((event) =>
				this._onDidChangeSelection.fire({
					reason: embeddedSelectionChangeReason(event),
				}),
			),
		);
		this.embeddedSelectionListeners.value = store;
	}

	private restoreEmbeddedSelection(options: IEditorOptions | undefined): void {
		const selection = reviewEmbeddedSelectionFromOptions(options);
		if (!selection) return;
		selection.restoreInCanvas();
	}

	/**
	 * Retargets the Toggle Inline View command at the in-tab diff. The diff
	 * editor commands duck-type this method on the active pane, so the Review
	 * tab answers for its embedded diff and no-ops in the other views.
	 */
	toggleRenderSideBySide(): void {
		this.diffViews.toggleRenderSideBySide();
	}

	override layout(_dimension: Dimension): void {
		// The canvas uses normal CSS flow and fills the editor pane.
	}

	private cachedSetupActions: ReviewCanvasSetupActions | undefined;

	/* One object for the pane's life: Home re-renders on each list change, and
	   New whiteboard reconnects, refetching its targets, when this changes. */
	private setupActions(): ReviewCanvasSetupActions {
		return this.cachedSetupActions ??= {
			load: () => this.loadInstallContent(),
			installCli: async () => { await this.commandService.executeCommand("review.installCliInPath"); },
			connection: async () => {
				const { serverUrl, token } = await this.desktopConnection.getConnection();
				return { serverUrl, token };
			},
			pickFolder: async () => {
				const picked = await this.fileDialogService.showOpenDialog({
					title: "Choose a project",
					openLabel: "Choose",
					canSelectFiles: false,
					canSelectFolders: true,
					canSelectMany: false,
				});
				return picked?.[0]?.fsPath;
			},
		};
	}

	private async resolveInstallContent(): Promise<ReviewCanvasInstallContent | undefined> {
		const status = await this.resolveInstallStatus();
		return status ? { status, ...this.installActions() } : undefined;
	}

	private async resolveInstallStatus(): Promise<ReviewCliInstallStatus | undefined> {
		try {
			return await this.desktopConnection.getCliInstallStatus();
		} catch (error) {
			this.logService.warn("Whiteboard install status failed", error);
			return undefined;
		}
	}

	private async loadInstallContent(): Promise<ReviewCanvasInstallContent> {
		return { status: await this.desktopConnection.getCliInstallStatus(), ...this.installActions() };
	}

	private cachedInstallActions: ReviewCanvasInstallActions | undefined;

	/* Stable like `setupActions`; each action resolves with the new status. */
	private installActions(): ReviewCanvasInstallActions {
		return this.cachedInstallActions ??= {
			apply: async (request) => {
				await this.desktopConnection.applyCliInstall(request);
				return this.desktopConnection.getCliInstallStatus();
			},
			remove: async (request) => {
				await this.desktopConnection.removeCliInstall(request);
				return this.desktopConnection.getCliInstallStatus();
			},
			removeLegacySkills: async () => {
				await this.desktopConnection.removeLegacySkills();
				return this.desktopConnection.getCliInstallStatus();
			},
			finishUpdate: async () => {
				await this.desktopConnection.finishCliInstallUpdate();
				return this.desktopConnection.getCliInstallStatus();
			},
			decline: async () => {
				await this.desktopConnection.declineCliInstall();
				return this.desktopConnection.getCliInstallStatus();
			},
			skip: async () => {
				await this.desktopConnection.skipCliInstallPrompts();
				return this.desktopConnection.getCliInstallStatus();
			},
			enablePrompts: async () => {
				await this.desktopConnection.resetCliInstallPrompts();
				return this.desktopConnection.getCliInstallStatus();
			},
		};
	}

	/**
	 * Settings state and actions for the Settings page. Every value lives in
	 * workbench configuration. Extensions reuse the existing quick pick.
	 */
	private async resolveSettingsContent(): Promise<ReviewCanvasSettingsContent> {
		return {
			telemetryEnabled: this.currentTelemetryEnabled(),
			setTelemetryEnabled: async (enabled) => {
				this.reviewTelemetryService.capture("setting_changed", {
					setting: "telemetry_enabled",
					enabled,
				});
				if (!enabled) {
					await this.reviewTelemetryService.flush();
				}
				await this.configurationService.updateValue(REVIEW_TELEMETRY_SETTING, enabled, ConfigurationTarget.USER);
				return this.currentTelemetryEnabled();
			},
			// Auto-detect can come back with imported VS Code settings; then show the theme on screen.
			theme: this.configurationService.getValue<boolean>("window.autoDetectColorScheme")
				? this.reviewThemeService.getColorTheme().settingsId
				: this.configurationService.getValue<string>("workbench.colorTheme"),
			setTheme: async (id) => {
				const picked = (await this.reviewThemeService.getColorThemes()).find((theme) => theme.settingsId === id);
				if (!picked) return this.configurationService.getValue<string>("workbench.colorTheme");
				this.reviewTelemetryService.capture("setting_changed", {
					setting: "theme",
					value: themeKind(picked.type),
				});
				return this.applyColorTheme(picked);
			},
			diffTheme: this.configurationService.getValue<string>(REVIEW_DIFF_COLOR_THEME_SETTING) ?? "",
			setDiffTheme: async (id) => {
				const kind = themeKind(this.reviewThemeService.getColorTheme().type);
				if (id && !(await this.reviewThemeService.getColorThemes()).some((theme) => theme.settingsId === id && themeKind(theme.type) === kind)) {
					return this.configurationService.getValue<string>(REVIEW_DIFF_COLOR_THEME_SETTING) ?? "";
				}
				this.reviewTelemetryService.capture("setting_changed", {
					setting: "diff_theme",
					enabled: Boolean(id),
				});
				await this.configurationService.updateValue(REVIEW_DIFF_COLOR_THEME_SETTING, id, ConfigurationTarget.USER);
				return this.configurationService.getValue<string>(REVIEW_DIFF_COLOR_THEME_SETTING) ?? "";
			},
			colorThemes: await this.colorThemeOptions(),
			importColorTheme: async () => {
				const [imported] = (await this.reviewInstantiationService.invokeFunction(importColorThemes)) ?? [];
				if (!imported) return undefined;
				return { theme: await this.applyColorTheme(imported), colorThemes: await this.colorThemeOptions() };
			},
			keymap: this.currentKeymap(),
			setKeymap: async (choice) => {
				this.reviewTelemetryService.capture("setting_changed", {
					setting: "keymap",
					enabled: true,
				});
				await this.commandService.executeCommand("review.setKeymap", choice);
				return this.currentKeymap();
			},
			openFilesIn: this.currentOpenFilesIn(),
			setOpenFilesIn: async (choice) => {
				// An application choice needs one picked first.
				if (choice === "application" && !this.currentOpenFilesIn().application) return this.chooseOpenFilesInApplication();
				this.reviewTelemetryService.capture("setting_changed", {
					setting: "open_files_in",
					enabled: true,
				});
				await this.configurationService.updateValue(REVIEW_OPEN_FILES_IN_SETTING, choice, ConfigurationTarget.USER);
				return this.currentOpenFilesIn();
			},
			chooseOpenFilesInApplication: () => this.chooseOpenFilesInApplication(),
			documentWidth: this.currentDocumentWidth(),
			setDocumentWidth: async (choice) => {
				this.reviewTelemetryService.capture("setting_changed", {
					setting: "document_width",
					enabled: choice !== "standard",
				});
				await this.configurationService.updateValue(REVIEW_DOCUMENT_WIDTH_SETTING, choice, ConfigurationTarget.USER);
				return this.currentDocumentWidth();
			},
			appearance: this.currentAppearance(),
			setAppearance: async (name, value) => {
				const { key, setting } = APPEARANCE_SETTINGS[name];
				const written = name === "diffWordWrap" ? (value ? "on" : "off") : value === "" ? undefined : value;
				this.reviewTelemetryService.capture("setting_changed", {
					setting,
					enabled: written !== undefined && written !== this.configurationService.inspect(key).defaultValue,
				});
				await this.configurationService.updateValue(key, written, ConfigurationTarget.USER);
				return this.currentAppearance();
			},
			readyNotification: this.currentReadyNotification(),
			setReadyNotification: async (choice) => {
				this.reviewTelemetryService.capture("setting_changed", {
					setting: "ready_notification",
					enabled: choice !== "off",
				});
				await this.configurationService.updateValue(REVIEW_READY_NOTIFICATION_SETTING, choice, ConfigurationTarget.USER);
				return this.currentReadyNotification();
			},
			softwareMapEnabled: this.currentSoftwareMapEnabled(),
			setSoftwareMapEnabled: async (enabled) => {
				this.reviewTelemetryService.capture("setting_changed", {
					setting: "software_map_enabled",
					enabled,
				});
				await this.configurationService.updateValue(REVIEW_SOFTWARE_MAP_SETTING, enabled, ConfigurationTarget.USER);
				return this.currentSoftwareMapEnabled();
			},
			showReleaseNotes: this.currentShowReleaseNotes(),
			setShowReleaseNotes: (enabled) => this.setShowReleaseNotes(enabled),
			animationsEnabled: await this.desktopConnection.readAnimationsEnabled().catch(() => false),
			setAnimationsEnabled: (enabled) => this.desktopConnection.setAnimationsEnabled(enabled),
			remoteHosts: reviewRemoteHostsSettings({
				get: (key) => this.configurationService.getValue(key),
				update: (key, value) => this.configurationService.updateValue(key, value, ConfigurationTarget.APPLICATION),
				connection: this.desktopConnection,
			}),
			request: async (path, init) => {
				const connection = await this.desktopConnection.getConnection();
				const headers = new Headers(init?.headers);
				if (connection.token) headers.set("x-review-token", connection.token);
				return requestReviewApi(`${connection.serverUrl}${path}`, { ...init, headers });
			},
			reloadWindow: async () => { await this.commandService.executeCommand("workbench.action.reloadWindow"); },
			diffrConfig: {
				saveSummarizer: (input) => this.desktopConnection.saveDiffrSummarizer(input),
				testSummarizer: (input) => this.desktopConnection.testDiffrSummarizer(input),
				read: () => this.desktopConnection.readDiffrConfig(),
				set: (key, value) => {
					this.reviewTelemetryService.capture("setting_changed", {
						setting: "diffr_config",
						enabled: true,
					});
					return this.desktopConnection.setDiffrConfigValue(key, value);
				},
			},
			manageExtensions: () => void this.commandService.executeCommand("review.manageExtensions"),
			importVsCodeSettings: () => void this.commandService.executeCommand("review.importUserConfig"),
			uninstallApp: () => void this.commandService.executeCommand("review.uninstallApp"),
		};
	}

	/** With auto-detect on, this sets the current mode's preferred theme. */
	private async applyColorTheme(theme: IWorkbenchColorTheme): Promise<string> {
		await this.reviewThemeService.setColorTheme(theme, ConfigurationTarget.USER);
		return this.reviewThemeService.getColorTheme().settingsId;
	}

	/** Whiteboard's own themes first, then the rest by name. */
	private async colorThemeOptions(): Promise<ReviewColorTheme[]> {
		return (await this.reviewThemeService.getColorThemes())
			.map((theme) => ({ id: theme.settingsId, label: theme.label, kind: themeKind(theme.type) }))
			.sort((a, b) => Number(!a.label.startsWith("Whiteboard")) - Number(!b.label.startsWith("Whiteboard")) || a.label.localeCompare(b.label));
	}

	private currentKeymap(): ReviewKeymapChoice {
		return this.configurationService.getValue<ReviewKeymapChoice>(REVIEW_KEYMAP_SETTING) ?? "none";
	}

	private currentOpenFilesIn(): ReviewOpenFilesIn {
		const path = this.configurationService.getValue<string>(REVIEW_OPEN_FILES_IN_APPLICATION_SETTING);
		const application = path ? { path, name: basename(path).replace(/\.(app|exe)$/i, "") } : null;
		const value = this.configurationService.getValue<ReviewOpenFilesInChoice>(REVIEW_OPEN_FILES_IN_SETTING);
		const choice = REVIEW_OPEN_FILES_IN_CHOICES.includes(value) && (value !== "application" || application) ? value : "whiteboard";
		return { choice, application };
	}

	private async chooseOpenFilesInApplication(): Promise<ReviewOpenFilesIn> {
		const path = await this.desktopConnection.chooseApplication();
		if (!path) return this.currentOpenFilesIn();
		this.reviewTelemetryService.capture("setting_changed", {
			setting: "open_files_in",
			enabled: true,
		});
		await this.configurationService.updateValue(REVIEW_OPEN_FILES_IN_APPLICATION_SETTING, path, ConfigurationTarget.USER);
		await this.configurationService.updateValue(REVIEW_OPEN_FILES_IN_SETTING, "application", ConfigurationTarget.USER);
		return this.currentOpenFilesIn();
	}

	private currentDocumentWidth(): ReviewDocumentWidthChoice {
		const choice = this.configurationService.getValue<ReviewDocumentWidthChoice>(REVIEW_DOCUMENT_WIDTH_SETTING);
		return choice === "wide" || choice === "full" ? choice : "standard";
	}

	private currentAppearance(): ReviewAppearance {
		const value = <T,>(name: keyof ReviewAppearance) => this.configurationService.getValue<T>(APPEARANCE_SETTINGS[name].key);
		return {
			diagramFullscreenOnClick: value<boolean>("diagramFullscreenOnClick") === true,
			documentFontSize: value<number>("documentFontSize"),
			readingFont: value("readingFont") === "sans" ? "sans" : "serif",
			readingFontFamily: value<string>("readingFontFamily") ?? "",
			codeFontSize: value<number>("codeFontSize"),
			codeFontFamily: value<string>("codeFontFamily"),
			// `editor.fontLigatures` also takes font-feature-settings.
			fontLigatures: value<boolean | string>("fontLigatures") !== false,
			diffFontSize: value<number>("diffFontSize"),
			diffWordWrap: value("diffWordWrap") === "on",
			diffIgnoreWhitespace: value<boolean>("diffIgnoreWhitespace") !== false,
		};
	}

	private currentReadyNotification(): ReviewReadyNotificationChoice {
		return this.configurationService.getValue<ReviewReadyNotificationChoice>(REVIEW_READY_NOTIFICATION_SETTING) ?? "off";
	}

	private currentSoftwareMapEnabled(): boolean {
		return this.configurationService.getValue<boolean>(REVIEW_SOFTWARE_MAP_SETTING) === true;
	}

	private currentShowReleaseNotes(): boolean {
		return this.configurationService.getValue<boolean>(REVIEW_SHOW_RELEASE_NOTES_SETTING) !== false;
	}

	private async setShowReleaseNotes(enabled: boolean): Promise<boolean> {
		this.reviewTelemetryService.capture("setting_changed", { setting: "show_release_notes", enabled });
		await this.configurationService.updateValue(REVIEW_SHOW_RELEASE_NOTES_SETTING, enabled, ConfigurationTarget.USER);
		return this.currentShowReleaseNotes();
	}

	// The setting ships as true, so only an explicit false means opted out.
	private currentTelemetryEnabled(): boolean {
		return this.configurationService.getValue<boolean>(REVIEW_TELEMETRY_SETTING) !== false;
	}

	/**
	 * Step state for the Welcome rail, derived from the install status the
	 * caller already fetched, so one render costs one status round-trip. The
	 * rest is the review list.
	 */
	private resolveOnboarding(status: ReviewCliInstallStatus): ReviewCanvasOnboarding {
		return {
			installed: !status.cli || status.shim.installed,
			// Drafts are filtered out of this list, so this counts only a real
			// published review.
			published: this.storageService.getBoolean(REVIEW_HAS_PUBLISHED_BOARD, StorageScope.APPLICATION, false) || this.apiCatalog.reviews.length > 0,
		};
	}

	private async renderFailure(error: Error): Promise<void> {
		this.refreshProgress.stop();
		const generation = ++this.loadGeneration;
		if (await this.resetCanvasForGeneration(generation)) {
			await this.renderError(error, generation);
		}
	}

	private async renderError(error: unknown, generation?: number): Promise<void> {
		const activeGeneration = generation ?? ++this.loadGeneration;
		this.setCanvasState("error");
		await this.render(
			{
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			},
			activeGeneration,
		);
	}

	private async render(
		content: ReviewCanvasContent,
		generation: number,
		loadedAssets?: ReviewCanvasAssetsModule,
	): Promise<void> {
		if (!this.canvasMount) return;
		const assets = loadedAssets ?? (await this.loadAssets());
		if (generation !== this.loadGeneration) return;
		this.apiContent = content.kind === "api" ? content : undefined;
		if (this.canvas.value) {
			// A pending reveal waits for the new board's onReady, after its canvas subscribes.
			this.canvas.value.update(content);
		} else {
			this.canvas.value = assets.mountReviewCanvas(this.canvasMount, content, {
				feedback: {
					environment: !this.workbenchEnvironment.isBuilt ? "development" : this.productService.quality === "preview" ? "preview" : "production",
					submit: response => this.desktopConnection.submitFeedback(response),
					submitContact: contact => this.desktopConnection.submitFeedbackContact(contact),
					openReleaseNotes: () => void this.commandService.executeCommand(REVIEW_SHOW_RELEASE_NOTES_COMMAND_ID, undefined, "feedback"),
				},
				setupTooltip: this.setupTooltip,
				notify: (notification) => showReviewNotification(this.notificationService, notification),
				confirmDelete: async (titles, options) => {
					const openedGeneration = this.loadGeneration;
					const ids = options?.reviewIds ?? [];
					return confirmReviewDeletion(this.dialogService, titles,
						() => openedGeneration === this.loadGeneration && this.isVisible(),
						ids.length ? await this.namedOnDelete(ids) : undefined, options?.trash);
				},
				showMenu: request => {
					const openedGeneration = this.loadGeneration;
					const menu = showReviewCanvasMenu(this.contextMenuService, request,
						() => openedGeneration === this.loadGeneration && this.isVisible(), this.contextViewService);
					this.canvasMenu.value = menu;
					return menu;
				},
			});
		}
	}

	private loadAssets(): Promise<ReviewCanvasAssetsModule> {
		return loadReviewCanvasAssets();
	}

	private readonly setupTooltip: NonNullable<ReviewCanvasBridge["setupTooltip"]> = (target, content, tooltip) => {
		if (tooltip?.instant) return new ReviewTooltip(this.hoverService, target, { label: content, detail: tooltip.detail });
		const store = new DisposableStore();
		const hover = store.add(new MutableDisposable<IHoverWidget>());
		const options: IHoverOptions = {
			target,
			content: tooltip?.detail ? `${content}\n${tooltip.detail}` : content,
			position: { hoverPosition: HoverPosition.ABOVE },
			appearance: { compact: true, showPointer: true },
			persistence: { hideOnKeyDown: true },
		};
		const quick = store.add(new MutableDisposable());
		store.add(addDisposableListener(target, "mouseenter", () => {
			if (target.getAttribute("aria-expanded") === "true") return;
			if (!tooltip?.quick) {
				hover.value = this.hoverService.showDelayedHover(options, { groupId: "review-topbar", reducedDelay: true });
				return;
			}
			const delay = this.configurationService.getValue<number>("workbench.hover.reducedDelay") / 2;
			const timer = setTimeout(() => { hover.value = this.hoverService.showInstantHover(options); }, delay);
			quick.value = toDisposable(() => clearTimeout(timer));
		}));
		store.add(addDisposableListener(target, "mouseleave", () => quick.clear()));
		store.add(addDisposableListener(target, "focus", () => {
			if (!target.matches(":focus-visible") || target.getAttribute("aria-expanded") === "true") return;
			hover.value = this.hoverService.showInstantHover(options);
		}));
		for (const event of ["blur", "pointerdown", "click", "keydown"]) {
			store.add(addDisposableListener(target, event, () => { quick.clear(); hover.clear(); }));
		}
		return store;
	};

	/** The boards linking to these, and their children, for the delete
	 * confirmation, leaving out the boards asked about. Either is empty when
	 * it can't be read. */
	private async namedOnDelete(reviewIds: readonly string[]): Promise<ReviewDeleteNamed> {
		const listed = ({ title, pullRequestNumber }: ReviewDeleteListedBoard): ReviewDeleteListedBoard => ({
			title,
			...(pullRequestNumber && { pullRequestNumber }),
		});
		const asked = new Set(reviewIds);
		const client = new ReviewApiClient(await this.desktopConnection.getConnection());
		const [linkedFrom, movesUp] = await Promise.all([
			Promise.all(reviewIds.map((reviewId) => client.read<{ backlinks: ({ from: { board: string } } & ReviewDeleteListedBoard)[] }>(`/${encodeURIComponent(reviewId)}/links`)))
				.then((reads) => [...new Map(reads.flatMap(({ backlinks }) => backlinks)
					.filter((link) => !asked.has(link.from.board))
					.map((link) => [link.from.board, listed(link)])).values()])
				.catch((error) => {
					this.logService.warn("[Whiteboard] Could not read the boards linking here:", error);
					return [];
				}),
			client.read<ReviewApiSummary[]>("")
				.then((boards) => {
					const byId = new Map(boards.map((board) => [board.reviewId, board]));
					return reviewIds.flatMap((reviewId) => byId.get(reviewId)?.children ?? []).flatMap((id) => {
						const child = byId.get(id);
						return child && !asked.has(id) ? [listed({ ...child, pullRequestNumber: child.origin?.pullRequestNumber })] : [];
					});
				})
				.catch((error) => {
					this.logService.warn("[Whiteboard] Could not read the boards nested here:", error);
					return [];
				}),
		]);
		return { linkedFrom, movesUp };
	}

	/**
	 * Wraps the diff view factory so a view can put its file tree in the
	 * sidebar's Files section. The view still owns the tree.
	 */
	private withSidebarFileTree(reviewId: string, factory: ReviewDiffViewFactory): ReviewDiffViewFactory {
		return {
			files: factory.files,
			create: (spec) => {
				if (!spec.sidebarFileTree) return factory.create(spec);
				const host = this.sidebar.fileTreeHost(reviewId);
				const view = factory.create({ ...spec, fileTreeContainer: host.element });
				return {
					focus: () => view.focus(),
					setProgress: (progress) => view.setProgress?.(progress),
					reload: (lens) => view.reload?.(lens),
					revealSource: (source, sectionId) => view.revealSource?.(source, sectionId),
					revealFile: (path, options) => view.revealFile?.(path, options),
					setFindQuery: async (query) => await view.setFindQuery?.(query) ?? { matchCount: 0 },
					revealFindMatch: (index) => view.revealFindMatch?.(index),
					clearActiveFindMatch: () => view.clearActiveFindMatch?.(),
					clearFind: () => view.clearFind?.(),
					setAskMarks: (marks, mount) => view.setAskMarks?.(marks, mount),
					onDidError: (listener) => view.onDidError(listener),
					setFileTreeHidden: (hidden) => host.setHidden(hidden),
					dispose: () => {
						view.dispose();
						host.dispose();
					},
				} satisfies Required<ReviewDiffViewHandle>;
			},
		};
	}

	private pend(event: PendingBoardEvent): void {
		this.pendingReveal = { event, at: Date.now() };
		this.revealPending();
	}

	/** Hands a pending block reveal to the canvas once it shows that board. */
	private revealPending(): void {
		const pending = this.pendingReveal;
		// Every pane gets the request. Drop it after 10s so a board opened later doesn't jump.
		if (pending && Date.now() - pending.at > 10_000) this.pendingReveal = undefined;
		// Its canvas subscribes before it reports ready.
		const ready = this.readyInput !== undefined && this.readyInput === this.renderedInput;
		if (!pending || !this.pendingReveal || !this.canvas.value || !ready || pending.event.reviewId !== this.apiContent?.reviewId) return;
		this.pendingReveal = undefined;
		this.surfaceEvents.fire(pending.event);
	}

	/** The bridge members every canvas shares; `onReady` runs once the mount reports ready. */
	private sharedBridge(
		generation: number,
		onReady: () => void,
		lifecycle?: ReviewCanvasLoadLifecycle,
	): Pick<
		ReviewCanvasBridge,
		| "subscribe"
		| "currentTheme"
		| "onDidChangeTheme"
		| "currentInlineLineNumbers"
		| "setInlineLineNumbers"
		| "onDidChangeInlineLineNumbers"
		| "currentDiffLayout"
		| "setDiffLayout"
		| "onDidChangeDiffLayout"
		| "setupTooltip"
		| "notify"
		| "ready"
		| "reportDiagnostic"
		| "reportSidebar"
		| "reportSidebarLenses"
		| "sidebarShowsBoard"
		| "onDidChangeSidebarShowsBoard"
		| "sidebarLensList"
		| "askPanelHost"
		| "reportAsk"
		| "showThreads"
	> {
		return {
			subscribe: (listener) => this.surfaceEvents.event(listener),
			currentTheme: () => this.colorScheme(),
			onDidChangeTheme: (listener) => this.themeEvents.event(listener),
			currentInlineLineNumbers: () => this.diffViews.lineNumbers.get(),
			setInlineLineNumbers: show => this.diffViews.lineNumbers.set(show),
			onDidChangeInlineLineNumbers: listener => this.diffViews.lineNumbers.onDidChange(listener),
			currentDiffLayout: (scope) => this.diffViews.layout(scope).get(),
			setDiffLayout: (scope, layout) => this.diffViews.layout(scope).set(layout),
			onDidChangeDiffLayout: (scope, listener) => this.diffViews.layout(scope).onDidChange(listener),
			notify: (notification) => showReviewNotification(this.notificationService, notification),
			setupTooltip: this.setupTooltip,
			ready: () => {
				if (generation !== this.loadGeneration || !this.targetDocument) return;
				this.targetDocument.body.dataset["reviewCanvasReady"] = "true";
				onReady();
				this.revealPending();
			},
			sidebarShowsBoard: () => this.sidebar.showsBoard(this.apiContent?.reviewId),
			onDidChangeSidebarShowsBoard: (listener) => this.sidebar.onDidChangeBoard(listener),
			sidebarLensList: () => this.sidebar.lensList(this.apiContent?.reviewId),
			// Only the main window has the Ask column.
			askPanelHost: () => this.targetDocument === mainWindow.document ? this.askParts.host(this) : undefined,
			reportAsk: (state) => {
				if (generation !== this.loadGeneration) return;
				this.askParts.setDocked(this, state.docked);
				this.sidebar.reportAsk(this.apiContent?.reviewId, state);
			},
			showThreads: () => this.sidebar.showThreads(),
			reportSidebarLenses: (lenses) => {
				if (generation === this.loadGeneration) this.sidebar.reportLenses(this.apiContent?.reviewId, lenses);
			},
			reportSidebar: (state) => {
				if (generation === this.loadGeneration) this.sidebar.report(this.apiContent?.reviewId, state);
			},
			reportDiagnostic: (diagnostic) => {
				if (generation === this.loadGeneration && diagnostic.level === "error") {
					delete this.targetDocument?.body.dataset["reviewCanvasReady"];
				}
				const method = diagnostic.level === "error" ? console.error : console.warn;
				method(`[Whiteboard canvas ${diagnostic.source}] ${diagnostic.message}`, diagnostic.stack ?? "");
				lifecycle?.reportDiagnostic(diagnostic);
			},
		};
	}

	private canvasSettings(): ReviewCanvasSettings {
		return {
			diagramFullscreenOnClick: this.configurationService.getValue<boolean>(REVIEW_DIAGRAM_FULLSCREEN_ON_CLICK_SETTING) === true,
			softwareMapEnabled: this.currentSoftwareMapEnabled(),
			documentWidth: this.currentDocumentWidth(),
		};
	}

	private async resetCanvasForGeneration(generation: number): Promise<boolean> {
		if (generation !== this.loadGeneration) {
			return false;
		}
		this.readyInput = undefined;
		this.inlineEditors.reset();
		this.diffViews.reset();
		return generation === this.loadGeneration;
	}

	private setCanvasState(state: ReviewCanvasState, reviewId?: string): void {
		if (!this.targetDocument) return;
		this.targetDocument.body.dataset["reviewCanvasState"] = state;
		if (state === "active" && reviewId) {
			this.targetDocument.body.dataset["reviewId"] = reviewId;
			delete this.targetDocument.body.dataset["reviewCanvasReady"];
		} else {
			delete this.targetDocument.body.dataset["reviewId"];
			delete this.targetDocument.body.dataset["reviewCanvasReady"];
		}
	}

	private colorScheme(): ReviewTheme {
		return themeKind(this.reviewThemeService.getColorTheme().type);
	}
}

function themeKind(type: ColorScheme): ReviewColorThemeKind {
	return type === ColorScheme.LIGHT || type === ColorScheme.HIGH_CONTRAST_LIGHT ? "light" : "dark";
}

class ReviewCanvasPlaceholderPart extends Part {
	override readonly minimumWidth = 0;
	override readonly maximumWidth = Number.POSITIVE_INFINITY;
	override readonly minimumHeight = 0;
	override readonly maximumHeight = Number.POSITIVE_INFINITY;

	constructor(
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
	) {
		super(
			Parts.REVIEW_CANVAS_PART,
			{ hasTitle: false, borderWidth: () => 0 },
			themeService,
			storageService,
			layoutService,
		);
	}

	override create(parent: HTMLElement): void {
		this.element = parent;
		super.create(parent);
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		return parent;
	}

	toJSON(): object {
		return { type: Parts.REVIEW_CANVAS_PART };
	}
}

export const IReviewCanvasPartsService = createDecorator<IReviewCanvasPartsService>("reviewCanvasPartsService");

export interface IReviewCanvasPartsService {
	readonly _serviceBrand: undefined;
}

export class ReviewCanvasParts extends Disposable implements IReviewCanvasPartsService {
	declare readonly _serviceBrand: undefined;

	constructor(@IInstantiationService instantiationService: IInstantiationService) {
		super();
		this._register(instantiationService.createInstance(ReviewCanvasPlaceholderPart));
	}
}
