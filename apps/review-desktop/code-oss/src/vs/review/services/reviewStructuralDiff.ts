import type { IDocumentDiffProvider, IDocumentDiff } from "../../editor/common/diff/documentDiffProvider.js";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StructuralDiffSession } from "./reviewStructuralDiffSession.js";
import { IModelService } from "../../editor/common/services/model.js";
import { ITextModelService } from "../../editor/common/services/resolverService.js";
import { ILanguageService } from "../../editor/common/languages/language.js";
import { URI } from "../../base/common/uri.js";
import { Event } from "../../base/common/event.js";
import { DisposableMap, DisposableStore } from "../../base/common/lifecycle.js";
import { CancellationError } from "../../base/common/errors.js";
import { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { ServiceCollection } from "../../platform/instantiation/common/serviceCollection.js";
import { IDiffProviderFactoryService } from "../../editor/browser/widget/diffEditor/diffProviderFactoryService.js";
import { ICodeEditorService } from "../../editor/browser/services/codeEditorService.js";
import type { IDiffEditor } from "../../editor/browser/editorBrowser.js";
import { LineRange } from "../../editor/common/core/ranges/lineRange.js";
import { DetailedLineRangeMapping } from "../../editor/common/diff/rangeMapping.js";
import { autorun, type IObservable } from "../../base/common/observable.js";
import type { UnchangedRegion } from "../../editor/browser/widget/diffEditor/diffEditorViewModel.js";
import {
	structuralContextGaps,
	structuralContextScopes,
	structuralRows,
	structuralHighlights,
} from "../common/reviewStructuralDiff.js";
import type { ReviewFilesEditorEntry } from "./reviewFilesDiffView.js";
import { StructuralFoldControls, StructuralFoldHover } from "./reviewStructuralFolds.js";
import { REVIEW_API_SOURCE_SCHEME } from "../common/reviewSourceView.js";
import type { StructuralViewedState } from "./reviewStructuralViewed.js";

/** View-owned Monaco providers and editor listeners; comparison state lives in session. */
export function createStructuralDiffEditors(
	instantiation: IInstantiationService,
	entries: readonly ReviewFilesEditorEntry[],
	lifetime: DisposableStore,
	session: StructuralDiffSession,
	viewed?: StructuralViewedState,
): { instantiation: IInstantiationService; entries: readonly ReviewFilesEditorEntry[] } {
	// These models belong to this comparison. A live file can change while the
	// comparison is open, so its editor text must come from diffr's own result.
	const modelService = instantiation.invokeFunction((a) => a.get(IModelService));
	const resolver = instantiation.invokeFunction((a) => a.get(ITextModelService));
	const languages = instantiation.invokeFunction((a) => a.get(ILanguageService));
	const viewId = ++structuralViewId;
	const sources = new Map<string, { path: string; side: "lhs" | "rhs"; unchangedBase?: URI }>();
	const unchangedTexts = new Map<string, Promise<string>>();
	const snapshotUri = (uri: URI, path: string, side: "lhs" | "rhs", unchangedBase?: URI) => {
		const query = new URLSearchParams(uri.query);
		query.set("structuralView", String(viewId));
		const snapshot = uri.with({ query: query.toString() });
		sources.set(snapshot.toString(), { path, side, unchangedBase });
		return snapshot;
	};
	lifetime.add(resolver.registerTextModelContentProvider(REVIEW_API_SOURCE_SCHEME, {
		provideTextContent: async uri => {
			const source = sources.get(uri.with({ fragment: "" }).toString());
			if (!source) return null;
			const existing = modelService.getModel(uri);
			if (existing) return existing;
			let text: string;
			if (source.unchangedBase) {
				let read = unchangedTexts.get(source.path);
				if (!read) {
					read = resolver.createModelReference(source.unchangedBase).then(reference => {
						try { return reference.object.textEditorModel.getValue(); }
						finally { reference.dispose(); }
					});
					unchangedTexts.set(source.path, read);
				}
				text = await read;
			} else {
				const result = await session.fileResult(source.path);
				if (result.error) throw new Error(result.error);
				if (result.diff?.type !== "text") throw new Error(`diffr did not supply a text result for ${source.path}.`);
				text = result.diff[source.side]?.text ?? "";
			}
			return modelService.getModel(uri) ?? modelService.createModel(text, languages.createByFilepathOrFirstLine(uri, text.split("\n", 1)[0]), uri);
		},
	}));
	lifetime.add(resolver.registerTextModelContentProvider("review-structural-empty", {
		provideTextContent: async uri => modelService.getModel(uri) ?? modelService.createModel("", null, uri),
	}));
	const resolvedEntries = entries.map(entry => ({
		...entry,
		original: entry.original ? snapshotUri(entry.original, entry.file.path, "lhs", entry.file.status === "unchanged" ? entry.original : undefined) : URI.from({ scheme: "review-structural-empty", path: "/base/" + entry.file.path, query: entry.modified!.toString() }),
		modified: entry.modified ? snapshotUri(entry.modified, entry.file.path, "rhs", entry.file.status === "unchanged" ? entry.original : undefined) : URI.from({ scheme: "review-structural-empty", path: "/head/" + entry.file.path, query: entry.original!.toString() }),
	}));
	const unchanged = new Set(entries.filter(e => e.file.status === "unchanged").map(e => e.file.path));
	const pairs = new Map(resolvedEntries.map(e => [e.original!.toString() + "\n" + e.modified!.toString(), e.file.path]));
	const factory: IDiffProviderFactoryService = {
		_serviceBrand: undefined,
		createDiffProvider: () => new StructuralDiffProvider(session, pairs, unchanged),
	};
	const child = lifetime.add(
		instantiation.createChild(new ServiceCollection([IDiffProviderFactoryService, factory])),
	);
	attachStructuralEditors(instantiation, resolvedEntries, session, lifetime, viewed);
	return { instantiation: child, entries: resolvedEntries };
}

let structuralViewId = 0;

/** Adapts session snapshots and fold state to Monaco's diff interface. */
export class StructuralDiffProvider implements IDocumentDiffProvider {
	private path: string | undefined;
	readonly onDidChange: Event<void>;
	constructor(private readonly session: StructuralDiffSession, private readonly pairs: ReadonlyMap<string, string>, private readonly unchanged: ReadonlySet<string>) {
		this.onDidChange = Event.map(Event.filter(session.onDidChange, change => this.path !== undefined && change.files.has(this.path)), () => undefined);
	}
	async computeDiff(...[original, modified, _options, token]: Parameters<IDocumentDiffProvider["computeDiff"]>): Promise<IDocumentDiff> {
		if (token.isCancellationRequested) throw new CancellationError();
		const path = this.pairs.get(original.uri.with({ fragment: "" }).toString() + "\n" + modified.uri.with({ fragment: "" }).toString());
		this.path = path;
		if (path !== undefined && this.unchanged.has(path)) {
			if (original.getValue() !== modified.getValue()) throw new Error("Referenced context file changed; reload the session.");
			return { changes: [], moves: [], identical: true, quitEarly: false };
		}
		if (path !== undefined && this.session.getFileResult(path)?.diff?.type === "binary") {
			return { changes: [], moves: [], identical: false, quitEarly: false, changeHighlights: { original: [], modified: [] } };
		}
		const diff = path === undefined ? undefined : this.session.getTextDiff(path);
		if (!diff) throw new Error("diffr did not supply a result for this file.");
		const left = (diff.lhs?.text ?? "").replace(/\r\n/g, "\n");
		const right = (diff.rhs?.text ?? "").replace(/\r\n/g, "\n");
		if (
			original.getLinesContent().join("\n") !== left ||
			modified.getLinesContent().join("\n") !== right
		) {
			throw new Error(
				"diffr sources differ from Whiteboard's editor snapshots; reload the session.",
			);
		}
		const rows = structuralRows(diff);
		// Changed-ness comes from the wire: a one-sided row, or a paired row whose line carries a changed span.
		const highlights = structuralHighlights(diff);
		const changedLeft = new Set(highlights.originalLines), changedRight = new Set(highlights.modifiedLines);
		const changes: DetailedLineRangeMapping[] = [];
		let l = 0,
			r = 0;
		let start: [number, number] | undefined;
		const flush = () => {
			if (start)
				changes.push(
					new DetailedLineRangeMapping(
						new LineRange(start[0] + 1, l + 1),
						new LineRange(start[1] + 1, r + 1),
						undefined,
					),
				);
			start = undefined;
		};
		for (const [a, b] of rows) {
			const changed = a === null || b === null || changedLeft.has(a + 1) || changedRight.has(b + 1);
			if (changed) start ??= [l, r];
			else flush();
			if (a !== null) l = a + 1;
			if (b !== null) r = b + 1;
		}
		flush();
		return {
			changes,
			moves: [],
			identical: left === right,
			quitEarly: false,
			sourceLineAlignment: rows,
			contextScopes: structuralContextScopes(diff),
			// Every collapsed region is hidden, labelled by the wire, as a band or on its header line.
			// StructuralFoldControls draws the fold controls.
			contextGaps: structuralContextGaps(
				diff,
				(id) => this.session.isRegionCollapsed(path!, id) === true,
				(id) => this.session.isRegionCollapsed(path!, id),
			).map(gap => ({ ...gap, foldControl: false, breadcrumbs: false })),
			changeHighlights: highlights,
		};
	}
}

/**
 * Keeps each structural diff editor's bands in step with the collapse state:
 * a band a reader reveals (its arrows, or double-click) marks its fold state
 * open, which covers both sides by construction, and the visible counts follow.
 */
function attachStructuralEditors(
	instantiation: IInstantiationService,
	entries: readonly ReviewFilesEditorEntry[],
	session: StructuralDiffSession,
	lifetime: DisposableStore,
	viewed?: StructuralViewedState,
): void {
	const editors = instantiation.invokeFunction((a) => a.get(ICodeEditorService));
	const pairs = new Map(entries.map((e) => [e.original!.toString() + "\n" + e.modified!.toString(), e.file.path]));
	const watched = lifetime.add(new DisposableMap<IDiffEditor, DisposableStore>());
	function watch(editor: IDiffEditor) {
		const widget = editor as unknown as { unchangedRegions?: IObservable<readonly UnchangedRegion[]> };
		if (!widget.unchangedRegions) return;
		const store = new DisposableStore();
		watched.set(editor, store);
		const pathOf = () => {
			const model = editor.getModel();
			return model ? pairs.get(model.original.uri.with({ fragment: "" }).toString() + "\n" + model.modified.uri.with({ fragment: "" }).toString()) : undefined;
		};
		const hover = new StructuralFoldHover();
		store.add(new StructuralFoldControls(editor.getOriginalEditor(), "lhs", pathOf, session, widget.unchangedRegions, hover, viewed));
		store.add(new StructuralFoldControls(editor.getModifiedEditor(), "rhs", pathOf, session, widget.unchangedRegions, hover, viewed));
		let revealed = new Set<UnchangedRegion>();
		store.add(
			autorun((reader) => {
				const path = pathOf();
				const regions = widget.unchangedRegions!.read(reader);
				if (!path || !session.getTextDiff(path)) return;
				const gaps = structuralContextGaps(session.getTextDiff(path)!, (id) => session.isRegionCollapsed(path, id) === true, (id) => session.isRegionCollapsed(path, id));
				const next = new Set<UnchangedRegion>();
				const gapOf = (region: UnchangedRegion) =>
					gaps.find((g) => g.originalStart === region.originalLineNumber && g.modifiedStart === region.modifiedLineNumber && g.foldStateId === region.foldStateId);
				for (const region of regions) {
					const shown = region.visibleLineCountTop.read(reader) + region.visibleLineCountBottom.read(reader);
					const fullyShown = shown >= region.lineCount;
					if (shown > 0 && !fullyShown && !region.band) {
						// A fold on its header line has no band to show a partial reveal, so open it fully.
						const gap = gapOf(region);
						if (gap) session.setRegionCollapsed(path, gap.foldStateId, false);
						continue;
					}
					if (fullyShown) {
						next.add(region);
						if (revealed.has(region)) continue;
						const gap = gapOf(region);
						if (!gap) continue;
						session.setRegionCollapsed(path, gap.foldStateId, false);
					} else if (revealed.has(region)) {
						// Monaco's own fold control closed a region we had marked open.
						const gap = gapOf(region);
						if (!gap) continue;
						session.setRegionCollapsed(path, gap.foldStateId, true);
					}
				}
				revealed = next;
			}),
		);
	}

	lifetime.add(editors.onDiffEditorRemove(editor => watched.deleteAndDispose(editor)));
	lifetime.add(editors.onDiffEditorAdd(watch));
	for (const editor of editors.listDiffEditors()) watch(editor);
}
