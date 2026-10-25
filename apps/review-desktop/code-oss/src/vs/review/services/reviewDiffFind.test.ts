import assert from 'node:assert/strict';
import test from 'node:test';
import { URI } from '../../base/common/uri.js';
import { IDiffProviderFactoryService } from '../../editor/browser/widget/diffEditor/diffProviderFactoryService.js';
import { Range } from '../../editor/common/core/range.js';
import type { IDocumentDiff } from '../../editor/common/diff/documentDiffProvider.js';
import { IModelService } from '../../editor/common/services/model.js';
import { ITextModelService } from '../../editor/common/services/resolverService.js';
import type { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import type { ReviewDiffLens, ReviewFindQuery } from '../common/reviewProtocol.js';
import { DiffFindIndex, findInEntries, type DiffFindFolds } from './reviewDiffFind.js';
import type { ReviewFilesEditorEntry } from './reviewFilesDiffView.js';

const query = (text: string, extra: Partial<ReviewFindQuery> = {}): ReviewFindQuery => ({ text, matchCase: false, wholeWord: false, isRegex: false, ...extra });

function model(uri: URI, lines: string[]) {
	const position = (offset: number) => {
		const before = lines.join('\n').slice(0, offset).split('\n');
		return [before.length, before[before.length - 1].length + 1] as const;
	};
	return {
		uri,
		getLineCount: () => lines.length,
		getLineContent: (line: number) => lines[line - 1],
		getVersionId: () => 1,
		isDisposed: () => false,
		getValueInRange: (range: Range) => {
			const offset = (line: number, column: number) => lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0) + column - 1;
			return lines.join('\n').slice(offset(range.startLineNumber, range.startColumn), offset(range.endLineNumber, range.endColumn));
		},
		dispose() { },
		findMatches: (text: string, _scope: unknown, isRegex: boolean, matchCase: boolean) => {
			const expression = new RegExp(isRegex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
			if (isRegex && text.includes('\\n')) return [...lines.join('\n').matchAll(expression)].map(hit => {
				const [startLine, startColumn] = position(hit.index), [endLine, endColumn] = position(hit.index + hit[0].length);
				return { range: new Range(startLine, startColumn, endLine, endColumn), matches: null };
			});
			return lines.flatMap((content, index) => [...content.matchAll(expression)].map(hit => ({
				range: new Range(index + 1, hit.index + 1, index + 1, hit.index + 1 + hit[0].length), matches: null,
			})));
		},
	};
}

const identity = (count: number): IDocumentDiff => ({
	changes: [], moves: [], identical: false, quitEarly: false,
	sourceLineAlignment: Array.from({ length: count }, (_, line) => [line, line] as const),
});

function harness(files: Record<string, { base?: string[]; head?: string[]; diff?: IDocumentDiff }>) {
	const models = new Map<string, ReturnType<typeof model>>();
	const diffs = new Map<string, IDocumentDiff>();
	const entries: ReviewFilesEditorEntry[] = Object.entries(files).map(([path, { base, head, diff }]) => {
		const original = base ? URI.parse(`test:/base/${path}`) : undefined;
		const modified = head ? URI.parse(`test:/head/${path}`) : undefined;
		if (original && base) models.set(original.toString(), model(original, base));
		if (modified && head) models.set(modified.toString(), model(modified, head));
		if (diff) diffs.set(path, diff);
		return {
			file: { path, status: base && head ? 'modified' : base ? 'deleted' : 'added', additions: 0, deletions: 0 },
			original, modified, goToFileResource: (modified ?? original)!,
		};
	});
	const resolver = {
		createModelReference: async (uri: URI) => ({ object: { textEditorModel: models.get(uri.toString()) }, dispose() { } }),
	};
	const factory = {
		createDiffProvider: () => ({
			computeDiff: async (original: { uri: URI }, modified: { uri: URI }) => {
				const path = modified.uri.path.replace('/head/', '');
				return diffs.get(path) ?? identity(models.get(original.uri.toString())!.getLineCount());
			},
		}),
	};
	const modelService = { createModel: (text: string, _language: null, uri: URI) => model(uri, text.split('\n')) };
	const instantiation = {
		invokeFunction: (fn: (accessor: { get(id: unknown): unknown }) => unknown) => fn({
			get: (id: unknown) => id === ITextModelService ? resolver : id === IDiffProviderFactoryService ? factory : id === IModelService ? modelService : undefined,
		}),
	} as unknown as IInstantiationService;
	return { entries, instantiation };
}

const summary = (matches: Awaited<ReturnType<typeof findInEntries>>) => matches.map(match => `${match.file}:${match.side}:${match.range.startLineNumber}`);

test('orders hits by file then aligned row and drops base hits on unchanged lines', async () => {
	const { entries, instantiation } = harness({
		'b.ts': { base: ['foo'], head: ['foo', 'foo'], diff: { ...identity(1), sourceLineAlignment: [[0, 0], [null, 1]] } },
		'a.ts': { base: ['foo 1', 'same foo', 'bar'], head: ['foo 1x', 'same foo', 'bar foo'] },
	});
	const matches = await findInEntries(instantiation, entries, undefined, query('foo'));
	assert.deepEqual(summary(matches), ['b.ts:head:1', 'b.ts:head:2', 'a.ts:base:1', 'a.ts:head:1', 'a.ts:head:2', 'a.ts:head:3']);
});

test('a lens drops hits outside it', async () => {
	const lens: ReviewDiffLens = { id: 'l', title: 'l', reviewId: 'r', version: 1, ranges: [{ file: 'a.ts', side: 'head', fromLine: 1, toLine: 1 }] };
	const { entries, instantiation } = harness({
		'a.ts': {
			base: ['foo', 'foo'], head: ['foo', 'foo', 'foo'],
			diff: { ...identity(2), contextGaps: [{ originalStart: 2, modifiedStart: 2, originalCount: 1, modifiedCount: 2, label: 'Outside lens' }] },
		},
	});
	const matches = await findInEntries(instantiation, entries, lens, query('foo'));
	assert.deepEqual(summary(matches), ['a.ts:head:1']);
});

test('skip folded leaves out collapsed files and hidden lines', async () => {
	const { entries, instantiation } = harness({
		'a.ts': { base: ['foo old'], head: ['foo', 'ctx foo', 'foo'], diff: { ...identity(1), sourceLineAlignment: [[0, 0], [null, 1], [null, 2]] } },
		'b.ts': { head: ['foo'] },
	});
	const folds: DiffFindFolds = {
		itemCollapsed: entry => entry.file.path === 'b.ts',
		hiddenLines: async (_entry, side) => side === 'head' ? [{ from: 2, to: 2 }] : [],
	};
	const index = new DiffFindIndex(instantiation, entries, undefined);
	assert.deepEqual(summary(await index.find(query('foo'), folds)), ['a.ts:base:1', 'a.ts:head:1', 'a.ts:head:2', 'a.ts:head:3', 'b.ts:head:1']);
	assert.deepEqual(summary(await index.find(query('foo', { skipFolded: true }), folds)), ['a.ts:base:1', 'a.ts:head:1', 'a.ts:head:3']);
	index.dispose();
});

test('a multiline regex matches within one file and side, never across them', async () => {
	const { entries, instantiation } = harness({
		'a.ts': { base: ['alpha', 'old'], head: ['alpha', 'new'] },
		'b.ts': { head: ['tail foo'] },
		'c.ts': { head: ['bar head'] },
	});
	const regex = (text: string, extra: Partial<ReviewFindQuery> = {}) => findInEntries(instantiation, entries, undefined, query(text, { isRegex: true, ...extra }));
	assert.deepEqual(summary(await regex('alpha\\nnew')), ['a.ts:head:1']);
	assert.deepEqual(summary(await regex('alpha\\nold')), ['a.ts:base:1']);
	// The unchanged first line counts once, on head.
	assert.deepEqual(summary(await regex('^alpha\\n')), ['a.ts:head:1']);
	assert.deepEqual(summary(await regex('foo\\nbar')), []);
	// A base hit on changed text counts even when head has a hit in the same place.
	assert.deepEqual(summary(await regex('alpha\\n\\w+')), ['a.ts:base:1', 'a.ts:head:1']);
	assert.deepEqual(summary(await regex('alpha(?=\\nold)')), ['a.ts:base:1']);
});

test('a multiline base hit counts when it touches a changed line, or head lost it', async () => {
	const { entries, instantiation } = harness({
		'a.ts': { base: ['alpha', 'beta'], head: ['alpha', 'inserted', 'beta'], diff: { ...identity(2), sourceLineAlignment: [[0, 0], [null, 1], [1, 2]] } },
		'b.ts': { base: ['alpha', 'set old'], head: ['alpha', 'set new'] },
	});
	const regex = (text: string) => findInEntries(instantiation, entries, undefined, query(text, { isRegex: true }));
	assert.deepEqual(summary(await regex('alpha\\nbeta')), ['a.ts:base:1']);
	// The same text shows on both sides of a changed line, as single-line hits do.
	assert.deepEqual(summary(await regex('alpha\\nset')), ['b.ts:base:1', 'b.ts:head:1']);
});

test('a multiline hit counts only when every line it spans is shown', async () => {
	const { entries, instantiation } = harness({ 'a.ts': { base: ['alpha', 'old'], head: ['alpha', 'new'] } });
	const index = new DiffFindIndex(instantiation, entries, undefined);
	const folds: DiffFindFolds = { itemCollapsed: () => false, hiddenLines: async (_entry, side) => side === 'head' ? [{ from: 2, to: 2 }] : [] };
	assert.deepEqual(summary(await index.find(query('alpha\\nnew', { isRegex: true, skipFolded: true }), folds)), []);
	assert.deepEqual(summary(await index.find(query('alpha\\nnew', { isRegex: true }), folds)), ['a.ts:head:1']);
	index.dispose();
});
