/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from "../../base/common/cancellation.js";
import { CancellationError } from "../../base/common/errors.js";
import { Disposable, DisposableStore, isDisposable } from "../../base/common/lifecycle.js";
import { setTimeout0 } from "../../base/common/platform.js";
import { URI } from "../../base/common/uri.js";
import { IDiffProviderFactoryService } from "../../editor/browser/widget/diffEditor/diffProviderFactoryService.js";
import { Range } from "../../editor/common/core/range.js";
import { USUAL_WORD_SEPARATORS } from "../../editor/common/core/wordHelper.js";
import type { ITextModel } from "../../editor/common/model.js";
import { isMultilineRegexSource } from "../../editor/common/model/textModelSearch.js";
import { IModelService } from "../../editor/common/services/model.js";
import { ITextModelService } from "../../editor/common/services/resolverService.js";
import type { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { alignmentRows } from "../common/reviewLens.js";
import type { ReviewDiffLens, ReviewFindQuery } from "../common/reviewProtocol.js";
import type { ReviewFilesEditorEntry } from "./reviewFilesDiffView.js";
import { lensRanges } from "./reviewLens.js";

export type DiffFindSide = "base" | "head";

export interface DiffFindMatch {
	entry: ReviewFilesEditorEntry;
	file: string;
	side: DiffFindSide;
	range: Range;
}

/** Inclusive one-based line span. */
export interface LineSpan {
	from: number;
	to: number;
}

export interface DiffFindFolds {
	itemCollapsed(entry: ReviewFilesEditorEntry): boolean;
	/** Lines hidden behind a fold. */
	hiddenLines(entry: ReviewFilesEditorEntry, side: DiffFindSide): Promise<readonly LineSpan[]>;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await map(items[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

interface IndexFile {
	entry: ReviewFilesEditorEntry;
	original: ITextModel | undefined;
	modified: ITextModel | undefined;
	/** 1 where a line is in the lens. */
	inLens: Record<DiffFindSide, Uint8Array>;
	/** Each base line's aligned head line, or 0. */
	twin: Int32Array;
}

interface IndexRow {
	file: IndexFile;
	side: DiffFindSide;
	line: number;
}

interface Built {
	key: string;
	model: ITextModel;
	rows: IndexRow[];
	files: IndexFile[];
	references: DisposableStore;
}

interface Hit {
	file: IndexFile;
	side: DiffFindSide;
	range: Range;
}

let nextIndexId = 0;

// Peeks build their indexes at once; yield so they never hold the renderer.
let sliceStart = 0;
const yieldSlice = async () => {
	if (performance.now() - sliceStart < 20) return;
	await new Promise<void>(resolve => setTimeout0(resolve));
	sliceStart = performance.now();
};

const versions = (files: readonly { original: ITextModel | undefined; modified: ITextModel | undefined }[]) =>
	files.map(({ original, modified }) => `${original?.getVersionId() ?? ""}/${modified?.getVersionId() ?? ""}`).join(",");

const fresh = (built: Built) =>
	built.files.every(({ original, modified }) => !original?.isDisposed() && !modified?.isDisposed()) && versions(built.files) === built.key;

/**
 * One text model for the whole view: head lines in order, base lines only where
 * they differ. A query is one `findMatches` plus a row lookup. Multiline
 * queries search each file's own models.
 */
export class DiffFindIndex extends Disposable {
	private built: Built | undefined;
	private building: Promise<Built> | undefined;

	constructor(
		private readonly instantiation: IInstantiationService,
		private readonly entries: readonly ReviewFilesEditorEntry[],
		private readonly lens: ReviewDiffLens | undefined,
	) {
		super();
		this._register({ dispose: () => this.install(undefined) });
	}

	async find(query: ReviewFindQuery, folds?: DiffFindFolds): Promise<DiffFindMatch[]> {
		if (!query.text) return [];
		const index = await this.ensureBuilt();
		const hits = query.isRegex && isMultilineRegexSource(query.text) ? searchFiles(index, query) : searchIndex(index, query);
		const matches: DiffFindMatch[] = [];
		const collapsed = new Map<IndexFile, boolean>();
		const hidden = new Map<Uint8Array, readonly LineSpan[]>();
		for (const { file, side, range } of hits) {
			const flags = file.inLens[side];
			if (!everyLine(range, line => flags[line - 1] === 1)) continue;
			if (folds && query.skipFolded) {
				let skip = collapsed.get(file);
				if (skip === undefined) collapsed.set(file, skip = folds.itemCollapsed(file.entry));
				if (skip) continue;
				let spans = hidden.get(flags);
				if (!spans) hidden.set(flags, spans = await folds.hiddenLines(file.entry, side));
				if (!everyLine(range, line => !spans!.some(span => line >= span.from && line <= span.to))) continue;
			}
			const { entry } = file;
			matches.push({ entry, side, file: side === "base" ? entry.file.previousPath ?? entry.file.path : entry.file.path, range });
		}
		return matches;
	}

	private ensureBuilt(): Promise<Built> {
		if (this.built && fresh(this.built)) return Promise.resolve(this.built);
		return this.building ??= this.build().finally(() => this.building = undefined);
	}

	private async build(): Promise<Built> {
		const references = new DisposableStore();
		try {
			const resolver = this.instantiation.invokeFunction(a => a.get(ITextModelService));
			// Each model is a round trip to the review server; load them side by side.
			const resolve = async (uri: URI | undefined) => uri ? references.add(await resolver.createModelReference(uri)).object.textEditorModel : undefined;
			const models = await mapLimit(this.entries, 16, async entry => ({ entry, original: await resolve(entry.original), modified: await resolve(entry.modified) }));
			const key = versions(models);
			const lifetime = new DisposableStore();
			const factory = this.instantiation.invokeFunction(a => a.get(IDiffProviderFactoryService));
			const provider = factory.createDiffProvider({ diffAlgorithm: "advanced" });
			if (isDisposable(provider)) lifetime.add(provider);
			const lines: string[] = [];
			const rows: IndexRow[] = [];
			const files: IndexFile[] = [];
			try {
				for (const { entry, original, modified } of models) {
					await yieldSlice();
					const diff = original && modified ? await provider.computeDiff(original, modified, { ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false }, CancellationToken.None) : undefined;
					const ranges = this.lens ? lensRanges(this.lens, entry) : undefined;
					const inLens = (side: DiffFindSide, line: number) => {
						if (!ranges) return true;
						const outside = diff?.contextGaps?.some(gap => gap.label === "Outside lens" && line >= (side === "base" ? gap.originalStart : gap.modifiedStart) && line < (side === "base" ? gap.originalStart + gap.originalCount : gap.modifiedStart + gap.modifiedCount));
						return !outside && (!!diff || ranges.some(range => range.side === side && line >= range.fromLine && line <= range.toLine));
					};
					const flags = (side: DiffFindSide, model: ITextModel | undefined) => Uint8Array.from({ length: model?.getLineCount() ?? 0 }, (_, index) => inLens(side, index + 1) ? 1 : 0);
					const file: IndexFile = { entry, original, modified, inLens: { base: flags("base", original), head: flags("head", modified) }, twin: new Int32Array(original?.getLineCount() ?? 0) };
					files.push(file);
					const emit = (side: DiffFindSide, model: ITextModel, line: number) => {
						lines.push(model.getLineContent(line));
						rows.push({ file, side, line });
					};
					if (original && modified && diff) {
						for (const [base, head] of alignmentRows(diff, original.getLineCount(), modified.getLineCount())) {
							if (base !== null && head !== null) file.twin[base] = head + 1;
							if (base !== null && (head === null || original.getLineContent(base + 1) !== modified.getLineContent(head + 1))) emit("base", original, base + 1);
							if (head !== null) emit("head", modified, head + 1);
						}
					} else {
						for (const [side, model] of [["base", original], ["head", modified]] as const) {
							if (!model) continue;
							for (let line = 1; line <= model.getLineCount(); line++) emit(side, model, line);
						}
					}
				}
			} finally {
				lifetime.dispose();
			}
			if (this._store.isDisposed) throw new CancellationError();
			const modelService = this.instantiation.invokeFunction(a => a.get(IModelService));
			// A simple-widget model stays out of extension-host document sync.
			const model = modelService.createModel(lines.join("\n"), null, URI.from({ scheme: "review-find-index", path: `/${++nextIndexId}` }), true);
			const built = { key, model, rows, files, references };
			this.install(built);
			return built;
		} catch (error) {
			references.dispose();
			throw error;
		}
	}

	private install(built: Built | undefined): void {
		if (this.built) {
			this.built.model.dispose();
			this.built.references.dispose();
		}
		this.built = built;
	}
}

/** A hit that ends at column 1 takes no text from its last line. */
const everyLine = (range: Range, test: (line: number) => boolean) => {
	const last = range.endColumn === 1 && range.endLineNumber > range.startLineNumber ? range.endLineNumber - 1 : range.endLineNumber;
	for (let line = range.startLineNumber; line <= last; line++) if (!test(line)) return false;
	return true;
};

const findIn = (model: ITextModel, query: ReviewFindQuery) =>
	// The default result cap is 999; a diff-wide count must be exact.
	model.findMatches(query.text, false, query.isRegex, query.matchCase, query.wholeWord ? USUAL_WORD_SEPARATORS : null, false, Number.MAX_SAFE_INTEGER);

function searchIndex(index: Built, query: ReviewFindQuery): Hit[] {
	return findIn(index.model, query).map(({ range }) => {
		const { file, side, line } = index.rows[range.startLineNumber - 1];
		return { file, side, range: new Range(line, range.startColumn, line, range.endColumn) };
	});
}

/**
 * A multiline query runs on each side's own model. A base hit that touches only
 * unchanged lines, and that head repeats on their twins, counts once, on head.
 */
function searchFiles(index: Built, query: ReviewFindQuery): Hit[] {
	return index.files.flatMap(file => {
		const { original, modified, twin } = file;
		const head = modified ? findIn(modified, query).map(({ range }) => range) : [];
		const onHead = new Set(head.map(range => range.toString()));
		const repeated = (range: Range) => {
			if (!original || !modified || !everyLine(range, line => twin[line - 1] > 0 && original.getLineContent(line) === modified.getLineContent(twin[line - 1]))) return false;
			const mirror = new Range(twin[range.startLineNumber - 1], range.startColumn, twin[range.endLineNumber - 1], range.endColumn);
			return onHead.has(mirror.toString()) && original.getValueInRange(range) === modified.getValueInRange(mirror);
		};
		const base = original ? findIn(original, query).map(({ range }) => range).filter(range => !repeated(range)) : [];
		return [...base.map(range => ({ file, side: "base" as const, range })), ...head.map(range => ({ file, side: "head" as const, range }))]
			.sort((left, right) => left.range.startLineNumber - right.range.startLineNumber);
	});
}

/** One-off search over entries that have no index. */
export async function findInEntries(instantiation: IInstantiationService, entries: readonly ReviewFilesEditorEntry[], lens: ReviewDiffLens | undefined, query: ReviewFindQuery): Promise<DiffFindMatch[]> {
	const index = new DiffFindIndex(instantiation, entries, lens);
	try { return await index.find(query); } finally { index.dispose(); }
}
