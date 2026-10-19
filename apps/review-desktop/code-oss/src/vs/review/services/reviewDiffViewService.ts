import { ContentHoverController } from "../../editor/contrib/hover/browser/contentHoverController.js";
import { orderReviewDiffFiles } from "../common/reviewChangedFilesModel.js";
import type { ReviewInlineEditorSpec, ReviewInlineEditorHandle, ReviewFindQuery, ReviewInlineFindResult, ReviewAskMark, ReviewAskPinMount } from "../common/reviewProtocol.js";
import { reviewFileCounts } from "../common/reviewStructuralDiff.js";
import type { ReviewDiffLayoutScope, ReviewDiffProgress } from "../common/reviewProtocol.js";
import { DiffFindIndex, findInEntries, type DiffFindMatch } from "./reviewDiffFind.js";
import { ReviewFindDecorations } from "./reviewFindDecorations.js";
import { ReviewAskMarks } from "./reviewAskMarks.js";
import { lensRanges, withLens } from "./reviewLens.js";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from "../../base/common/event.js";
import { Disposable, DisposableStore } from "../../base/common/lifecycle.js";
import type { URI } from "../../base/common/uri.js";
import type { ICodeEditor } from "../../editor/browser/editorBrowser.js";
import { RunOnceScheduler } from "../../base/common/async.js";
import { IStorageService } from "../../platform/storage/common/storage.js";
import { ReviewDiffViewStateStorage } from "./reviewDiffViewState.js";
import { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { REVIEW_PEEK_SIDE_BY_SIDE_SETTING } from "../common/reviewConfigurationDefaults.js";
import type {
	ReviewCommitScope,
	ReviewDiffLens,
	ReviewDiffFileWire,
	ReviewDiffViewHandle,
	ReviewDiffViewSpec,
} from "../common/reviewProtocol.js";
import { ReviewDiffLayoutSetting } from "./reviewDiffLayout.js";
import { markReviewEmbeddedEditor } from "./reviewEmbeddedNavigation.js";
import { markReviewDefinitionPeekHost } from "./reviewDefinitionPeek.js";
import { sourceLocation } from "../common/reviewSourceView.js";
import { ReviewFilesDiffView, ReviewFilesEditorInput, type ReviewFilesEditorEntry } from "./reviewFilesDiffView.js";
import { ReviewEmbeddedEditors } from "./reviewEmbeddedEditors.js";

import { createStructuralDiffEditors } from "./reviewStructuralDiff.js";
import { StructuralViewedState } from "./reviewStructuralViewed.js";
import { StructuralDiffSession, type StructuralSessionChange } from "./reviewStructuralDiffSession.js";
import type { StructuralDiffStream } from "./reviewStructuralDiffClient.js";
import { IReviewTelemetryService } from "./reviewTelemetryService.js";

export interface ReviewDiffViewSource {
	load(scope?: ReviewCommitScope, lens?: ReviewDiffLens): Promise<{
		sourceUri: URI; stateKey?: string; entries: readonly ReviewFilesEditorEntry[];
		session: StructuralDiffSession;
	}>;
	files(scope?: ReviewCommitScope): Promise<readonly ReviewDiffFileWire[]>;
}

/**
 * Mounts the changed-files diff UI inside the Review canvas. One instance
 * belongs to one canvas pane; live handles follow the pane while resumable
 * view state is kept in the host storage service.
 */
export class ReviewDiffViewService extends Disposable {
	private overflowWidgetsDomNode: HTMLElement | undefined;
	private readonly handles = new Set<DiffViewController>();
	comparisonGeneration = 0;
	private readonly sessions = new Map<string, { session: StructuralDiffSession; revision?: string }>();
	readonly diffLayout: ReviewDiffLayoutSetting;
	private readonly peekLayout: ReviewDiffLayoutSetting;
	/**
	 * Scroll and expansion state per session document. The Diff view is a
	 * conditionally rendered React sibling: a toggle away disposes the widget,
	 * so the state must survive outside it.
	 */
	private readonly viewStates: ReviewDiffViewStateStorage;

	constructor(
		private readonly inlineEditors: ReviewEmbeddedEditors,
		@IInstantiationService
		private readonly instantiationService: IInstantiationService,
		@IStorageService storage: IStorageService,
		@IReviewTelemetryService private readonly telemetry: IReviewTelemetryService,
	) {
		super();
		this.viewStates = new ReviewDiffViewStateStorage(storage);
		this._register(storage.onWillSaveState(() => {
			for (const handle of this.handles) handle.captureViewState();
		}));
		this.diffLayout = this._register(instantiationService.createInstance(ReviewDiffLayoutSetting, "diffEditor.renderSideBySide"));
		this.peekLayout = this._register(instantiationService.createInstance(ReviewDiffLayoutSetting, REVIEW_PEEK_SIDE_BY_SIDE_SETTING));
	}

	layout(scope: ReviewDiffLayoutScope): ReviewDiffLayoutSetting {
		return scope === "peek" ? this.peekLayout : this.diffLayout;
	}

	/** Shared by every view of this comparison; reset/dispose follows the canvas lifetime. */
	openComparison(key: string, client: StructuralDiffStream, generation: number, revision?: string): StructuralDiffSession | undefined {
		if (generation !== this.comparisonGeneration) return undefined;
		const current = this.sessions.get(key);
		if (current && current.revision === revision) return current.session;
		current?.session.dispose();
		const session = new StructuralDiffSession(client);
		this.sessions.set(key, { session, revision });
		void session.start().then(() => {
			const failure = session.failure();
			if (failure) this.telemetry.capture("diff_failed", failure);
		});
		return session;
	}

	override dispose(): void { this.reset(); super.dispose(); }

	setOverflowWidgetsDomNode(node: HTMLElement): void {
		this.overflowWidgetsDomNode = node;
	}

	create(spec: ReviewDiffViewSpec, source: ReviewDiffViewSource): ReviewDiffViewHandle {
		const handle = new DiffViewController(
			spec,
			this.instantiationService,
			this.inlineEditors,
			this.overflowWidgetsDomNode,
			spec.document ? this.peekLayout : this.diffLayout,
			this.viewStates,
			() => this.handles.delete(handle),
			source,
		);
		this.handles.add(handle);
		return handle;
	}

	/** Document peeks use the same controller, providers and widget as the Diff tab. */
	createDocument(spec: ReviewInlineEditorSpec, lens: ReviewDiffLens, source: ReviewDiffViewSource): ReviewInlineEditorHandle {
		const lifetime = new DisposableStore();
		const heightChanged = lifetime.add(new Emitter<number>());
		let height = 400;
		const embed: NonNullable<ReviewDiffViewSpec["document"]> = {
			heightMode: spec.heightMode,
			onDidChangeHeight: value => { height = value; heightChanged.fire(value); },
			onDidFocus: spec.onDidFocus, onDidOpen: spec.onDidOpen, onDidShowHover: spec.onDidShowHover,
			commit: spec.commit,
		};
		const view = this.create({
			container: spec.container, lens, progress: spec.progress,
			onSetViewed: spec.onSetViewed,
			document: embed,
		}, source) as DiffViewController;
		lifetime.add(view);
		return {
			get height() { return height; },
			setProgress: progress => view.setProgress(progress),
			setCommit: commit => { embed.commit = commit; view.refreshHeaders(); },
			onDidChangeHeight: heightChanged.event,
			onDidError: view.onDidError,
			setActive: active => spec.container.classList.toggle("review-document-code-active", active),
			setCollapsed: collapsed => view.setCollapsed(collapsed),
			setFindQuery: query => view.setFindQuery(query),
			revealFindMatch: index => { view.setCollapsed(false); view.revealFindMatch(index); },
			clearActiveFindMatch: () => view.clearActiveFindMatch(),
			clearFind: () => view.clearFind(),
			setAskMarks: (marks, mount) => view.setAskMarks(marks, mount),
			dispose: () => lifetime.dispose(),
		};
	}

	/** Search a peek that is not mounted, through the same providers its editor would use. */
	async findDocument(lens: ReviewDiffLens, source: ReviewDiffViewSource, query: ReviewFindQuery): Promise<DiffFindMatch[]> {
		if (!query.text) return [];
		const lifetime = new DisposableStore();
		try {
			const data = await source.load(undefined, lens);
			const entries = data.entries.filter(entry => lensRanges(lens, entry).length > 0);
			const structural = createStructuralDiffEditors(this.instantiationService, entries, lifetime, data.session);
			const instantiation = withLens(structural.instantiation, structural.entries, lens, lifetime, () => undefined, Event.None);
			return await findInEntries(instantiation, structural.entries, lens, query);
		} finally { lifetime.dispose(); }
	}

	reset(): void {
		this.comparisonGeneration++;
		for (const handle of [...this.handles]) handle.dispose();
		this.handles.clear();
		for (const { session } of this.sessions.values()) session.dispose();
		this.sessions.clear();
	}

	toggleRenderSideBySide(): void {
		void this.diffLayout.toggle();
	}
}

class DiffViewController extends Disposable implements ReviewDiffViewHandle {
	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError = this._onDidError.event;
	private readonly activeControlStore = this._register(new DisposableStore());
	private view: ReviewFilesDiffView | undefined;
	private progress: ReviewDiffProgress | undefined;
	private readonly progressChanged = this._register(new Emitter<void>());
	private pendingSectionId: string | undefined;
	private pendingSource: ReviewDiffLens['ranges'][number] | undefined;
	private pendingFile: string | undefined;
	private pendingFileRestore = false;
	private hasRestoredState = false;
	setProgress(progress: ReviewDiffProgress): void { this.progress = progress; this.view?.setProgress(progress); this.progressChanged.fire(); }
	revealSource(source: ReviewDiffLens['ranges'][number], sectionId?: string): void { this.pendingSource = source; this.pendingSectionId = sectionId; this.view?.revealSource(source, sectionId); }
	revealFile(path: string, options?: { restore?: boolean }): void {
		this.pendingFile = path;
		this.pendingFileRestore = options?.restore ?? false;
		if (!this.pendingFileRestore || !this.hasRestoredState) this.view?.revealFile(path);
	}
	private viewStateKey: string | undefined;
	private readonly saveState = this._register(new RunOnceScheduler(() => this.captureViewState(), 250));
	private adoptedEditors: readonly ICodeEditor[] = [];
	private disposed = false;
	private collapsed = false;
	setCollapsed(collapsed: boolean): void { this.collapsed = collapsed; this.view?.setCollapsed(collapsed); }

	private readonly ready: Promise<void>;
	private findIndex: DiffFindIndex | undefined;
	private diffEntries: readonly ReviewFilesEditorEntry[] = [];
	private matches: DiffFindMatch[] = [];
	private findGeneration = 0;
	private readonly decorations: ReviewFindDecorations;
	async setFindQuery(query: ReviewFindQuery): Promise<ReviewInlineFindResult> {
		const request = ++this.findGeneration;
		await this.ready;
		const view = this.view;
		if (this.disposed || request !== this.findGeneration || !this.findIndex || !view) return { matchCount: 0 };
		const matches = await this.findIndex.find(query, view.folds());
		if (this.disposed || request !== this.findGeneration) return { matchCount: 0 };
		this.matches = matches;
		this.decorations.set(matches.map(match => ({ uri: (match.side === "base" ? match.entry.original : match.entry.modified)!, range: match.range })));
		return { matchCount: matches.length };
	}
	revealFindMatch(index: number): void {
		const match = this.matches[index];
		if (!match) return;
		this.view?.revealSource({ file: match.file, side: match.side, fromLine: match.range.startLineNumber, toLine: match.range.endLineNumber }, match.entry.sectionId, { range: match.range, select: true });
		this.decorations.setActive(index);
	}
	clearActiveFindMatch(): void { this.decorations.setActive(undefined); }
	clearFind(): void { this.findGeneration++; this.matches = []; this.decorations.clear(); }

	private askMarks: ReviewAskMarks | undefined;
	setAskMarks(marks: readonly ReviewAskMark[], mount: ReviewAskPinMount): void {
		this.askMarks ??= this._register(this.instantiationService.createInstance(ReviewAskMarks, this.spec.container));
		this.askMarks.set(marks, mount);
	}
	refreshHeaders(): void { this.view?.refreshHeaders(); }

	constructor(
		private readonly spec: ReviewDiffViewSpec,
		private readonly instantiationService: IInstantiationService,
		private readonly inlineEditors: ReviewEmbeddedEditors,
		private readonly overflowWidgetsDomNode: HTMLElement | undefined,
		private readonly diffLayout: ReviewDiffLayoutSetting,
		private readonly viewStates: ReviewDiffViewStateStorage,
		private readonly onDispose: () => void,
		private readonly source: ReviewDiffViewSource,
	) {
		super();
		this.progress = spec.progress;
		this.decorations = this._register(instantiationService.createInstance(ReviewFindDecorations));
		this.ready = this.initialize();
	}

	focus(): void {
		this.view?.focus();
	}

	override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.captureViewState();
		// A view toggle disposes these editors. The composite must not keep one
		// of them as its active editor afterwards.
		for (const editor of this.adoptedEditors) {
			this.inlineEditors.clearExternalActiveEditor(editor);
		}
		this.adoptedEditors = [];
		this.view = undefined;
		super.dispose();
		this.onDispose();
	}

	private async initialize(): Promise<void> {
		try {
			const data = await this.source.load(this.spec.scope, this.spec.lens);
			const { sourceUri, entries, session } = data;
			this.viewStateKey = `${data.stateKey ?? sourceUri.toString()}:${JSON.stringify(this.spec.lens ?? null)}:${this.spec.document ? "document" : "diff"}`;
			if (this.disposed) return;
			const store = this._register(new DisposableStore());
			const viewed = this.spec.onSetViewed
				? store.add(new StructuralViewedState(session, entries, () => this.progress, this.progressChanged.event)) : undefined;
			const structural = createStructuralDiffEditors(this.instantiationService, entries, store, session, viewed);
			this.diffEntries = structural.entries;

			if (this.disposed) return;
			const lens = this.spec.lens;
			const sections = this.progress?.sections;
			let selected = lens && sections?.length ? sections.flatMap(section => {
				const matches = structural.entries.filter(entry => lensRanges({ ...lens, ranges: section.sources }, entry).length > 0);
				return matches.map((entry, index) => ({ ...entry, sectionId: section.id, sectionStart: index === 0, original: entry.original?.with({ fragment: section.id }), modified: entry.modified?.with({ fragment: section.id }) }));
			}) : lens ? structural.entries.filter(entry => lensRanges(lens, entry).length > 0) : structural.entries;
			// File lenses have no authored sections; follow the same order as their file tree.
			if (lens && !sections?.length) {
				const byFile = new Map(selected.map(entry => [entry.file, entry]));
				selected = orderReviewDiffFiles([...byFile.keys()]).map(file => byFile.get(file)!);
			}
			const instantiation = withLens(structural.instantiation, selected, lens, store, () => this.progress, this.progressChanged.event, !!viewed, !!this.spec.document);
			// Find ignores viewed state; folds come from the view.
			const sectionsOnly = () => this.progress?.sections && { sections: this.progress.sections, files: [] };
			this.findIndex = store.add(new DiffFindIndex(withLens(structural.instantiation, selected, lens, store, sectionsOnly, Event.None), selected, lens));
			// The input owns the text-model references its view model resolves, so
			// this handle disposes it alongside the view.
			const input = store.add(instantiation.createInstance(ReviewFilesEditorInput, sourceUri, selected,
				session));
			const view = store.add(
				instantiation.createInstance(
					ReviewFilesDiffView,
					this.spec.container,
					this.overflowWidgetsDomNode,
					this.diffLayout,
					this.spec.fileTreeContainer, this.spec.onToggleViewed, this.spec.onToggleSection, this.spec.document,
					this.spec.openFile !== false,
				),
			);
			this.view = view;
			view.viewedScope = lens && !lens.wholeFiles && !this.spec.document ? 'lens' : undefined;
			// Not the active control: it follows scrolling, not focus.
			if (!this.spec.document) store.add(markReviewDefinitionPeekHost(this.spec.container, resource => this.peekDiff(resource)));
			if (this.progress) view.setProgress(this.progress);
			view.startLoading(selected);
			store.add(view.onDidChangeActiveControl(() => this.bindActiveControl(view)));
			store.add(view.onDidScroll(() => this.saveState.schedule()));
			const itemKeys = selected.map(entry => JSON.stringify([entry.original?.toString(), entry.modified?.toString()]));
			const savedState = this.viewStates.get(this.viewStateKey, itemKeys);
			this.hasRestoredState = !!savedState;
			await view.setInput(input, savedState);
			if (this.disposed) return;
			this.bindActiveControl(view);
			if (this.spec.document) view.setCollapsed(this.collapsed);
			if (this.pendingSource) view.revealSource(this.pendingSource, this.pendingSectionId);
			else if (this.pendingFile && (!this.pendingFileRestore || !savedState)) view.revealFile(this.pendingFile);
			this.observeSession(session, selected, view, store);

		} catch (error) {
			if (this.disposed) return;
			this._onDidError.fire(error instanceof Error ? error.message : String(error));
		}
	}

	private observeSession(session: StructuralDiffSession, entries: readonly ReviewFilesEditorEntry[], view: ReviewFilesDiffView, store: DisposableStore): void {
		const rendered = new Set<string>();
		const renderCurrentState = (change?: StructuralSessionChange) => {
			if (this.disposed) return;
			for (const entry of entries) {
				const path = entry.file.path;
				if (change && !change.files.has(path)) continue;
				const result = entry.file.status === "unchanged" ? {} : session.getFileResult(path);
				if (!result || rendered.has(path)) continue;
				rendered.add(path);
				if (result.hidden !== undefined) view.hideFile(path, result.hidden);
				if (result.diff) view.fileCounts(path, reviewFileCounts(result.diff));
				view.fileLoaded(path, result.error);
			}
			if (session.error) view.loadingFailed(session.error);
			else if (session.complete) view.loadingFailed("diffr did not supply a result for this file.");
		};
		store.add(session.onDidChange(renderCurrentState));
		renderCurrentState();
	}

	/**
	 * Joins the embedded diff's inner editors to the canvas composite. Find and
	 * the editor context keys act on the composite's active editor, so a focused
	 * inner editor has to become that editor.
	 */
	private bindActiveControl(view: ReviewFilesDiffView): void {
		this.activeControlStore.clear();
		const diffEditor = view.getActiveControl();
		if (!diffEditor) return;
		const editors: readonly ICodeEditor[] = [diffEditor.getOriginalEditor(), diffEditor.getModifiedEditor(),
		];
		this.adoptedEditors = editors;
		for (const editor of editors) {
			this.activeControlStore.add(markReviewEmbeddedEditor(editor));
			if (this.spec.document) ReviewEmbeddedEditors.markDocumentEditor(editor);
			this.activeControlStore.add(
				editor.onDidFocusEditorText(() => { this.inlineEditors.setExternalActiveEditor(editor); this.spec.document?.onDidFocus?.(); }),
			);
			const hover = this.spec.document?.onDidShowHover && ContentHoverController.get(editor);
			if (hover) {
				this.activeControlStore.add(hover.onHoverContentsChanged(() => {
					if (hover.getWidgetContent()?.trim()) this.spec.document?.onDidShowHover?.();
				}));
			}
		}
	}

	private peekDiff(resource: URI): { original: URI; modified: URI } | undefined {
		const { file, side } = sourceLocation(resource);
		const entry = this.diffEntries.find(entry => entry.file.status !== "unchanged" && file === (side === "base" ? entry.file.previousPath ?? entry.file.path : entry.file.path));
		return entry?.original && entry.modified ? { original: entry.original, modified: entry.modified } : undefined;
	}

	captureViewState(): void {
		const key = this.viewStateKey;
		const state = this.view?.getViewState();
		if (!key || !state) return;
		this.viewStates.set(key, state);
	}
}
