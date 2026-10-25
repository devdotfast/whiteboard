import assert from 'node:assert/strict';
import test from 'node:test';
import { lensContextGaps } from './reviewLens.js';
import { LineRange } from '../../editor/common/core/ranges/lineRange.js';
import { DetailedLineRangeMapping } from '../../editor/common/diff/rangeMapping.js';
import type { IDocumentContextGap, IDocumentDiff } from '../../editor/common/diff/documentDiffProvider.js';
import { structuralContextScopes, type StructuralLeaf } from './reviewStructuralDiff.js';

const plain: IDocumentDiff = { changes: [], moves: [], identical: false, quitEarly: false };
test('a lens keeps disjoint attachments and hides the intervening code', () => {
	const gaps = lensContextGaps(plain, 100, 100, [
		{ side: 'head', file: 'a.ts', fromLine: 20, toLine: 22 },
		{ side: 'base', file: 'a.ts', fromLine: 70, toLine: 72 },
	]);
	assert.deepEqual(gaps.map(gap => [gap.originalStart, gap.originalCount]), [[1, 16], [26, 41], [76, 25]]);
});
test('one-sided inserted ranges use correspondence without hiding their opposite context', () => {
	const diff = { ...plain, sourceLineAlignment: Array.from({ length: 50 }, (_, i) => [null, i] as const) };
	const gaps = lensContextGaps(diff, 0, 50, [{ side: 'head', file: 'new.ts', fromLine: 20, toLine: 25 }]);
	assert.deepEqual(gaps.map(gap => [gap.originalCount, gap.modifiedStart, gap.modifiedCount, gap.change]), [[0, 1, 16, 'inserted'], [0, 29, 22, 'inserted']]);
});
test('structural folds within the lens survive, overlapping folds do not', () => {
	const inside = { originalStart: 20, modifiedStart: 20, originalCount: 3, modifiedCount: 3, label: 'body' };
	const outside = { originalStart: 1, modifiedStart: 1, originalCount: 20, modifiedCount: 20 };
	const gaps = lensContextGaps({ ...plain, contextGaps: [inside, outside] }, 100, 100, [{ side: 'base', file: 'a', fromLine: 18, toLine: 28 }]);
	assert.ok(gaps.includes(inside));
	assert.ok(!gaps.includes(outside));
});

test('a clipped outer fold leaves its nested fold usable in a code peek', () => {
	const parent = { originalStart: 1, modifiedStart: 1, originalCount: 20, modifiedCount: 20, foldStateId: 1, collapsed: true };
	const child = { originalStart: 8, modifiedStart: 8, originalCount: 5, modifiedCount: 5, foldStateId: 2, collapsed: true };
	const diff = { ...plain, contextGaps: [parent, child] };
	const clipped = lensContextGaps(diff, 20, 20, [{ side: 'head', file: 'a.ts', fromLine: 9, toLine: 11 }]);
	assert.deepEqual(clipped.filter(gap => gap.foldStateId).map(gap => gap.foldStateId), [2]);
	const whole = lensContextGaps(diff, 20, 20, [{ side: 'head', file: 'a.ts', fromLine: 1, toLine: 20 }]);
	assert.deepEqual(whole.filter(gap => gap.foldStateId).map(gap => gap.foldStateId), [1]);
});

// The head lines left on screen, as [from, to] runs.
const shownLines = (gaps: readonly IDocumentContextGap[], lineCount: number) => {
	const runs: [number, number][] = [];
	for (let line = 1; line <= lineCount; line++) {
		if (gaps.some(gap => gap.collapsed !== false && line >= gap.modifiedStart && line < gap.modifiedStart + gap.modifiedCount)) continue;
		const last = runs.at(-1);
		if (last && last[1] === line - 1) last[1] = line;
		else runs.push([line, line]);
	}
	return runs;
};
const head = (fromLine: number, toLine: number) => [{ side: 'head' as const, file: 'a.ts', fromLine, toLine }];

test('in an added file a lens shows the first and last lines of its enclosing scopes, not the whole file', () => {
	// A 30-line added file: a class on lines 3-25 with a method on lines 10-18. Nothing is collapsed.
	const added: IDocumentDiff = {
		...plain,
		sourceLineAlignment: Array.from({ length: 30 }, (_, i) => [null, i] as const),
		contextScopes: { original: [], modified: [[2, 25], [9, 18]] },
	};
	assert.deepEqual(shownLines(lensContextGaps(added, 0, 30, head(13, 14)), 30), [[3, 3], [10, 18], [25, 25]]);
	// The same, with a function on lines 27-29 folded.
	const folded: IDocumentDiff = {
		...added,
		contextScopes: { original: [], modified: [[2, 25], [9, 18], [26, 29]] },
		contextGaps: [{ originalStart: 1, originalCount: 0, modifiedStart: 27, modifiedCount: 3, collapsed: true }],
	};
	assert.deepEqual(shownLines(lensContextGaps(folded, 0, 30, head(13, 14)), 30), [[3, 3], [10, 18], [25, 25]]);
});

test('in a modified file a lens shows the whole run between collapsed bands', () => {
	// A function on lines 5-20, with the code before and after it collapsed.
	const modified: IDocumentDiff = {
		...plain,
		contextScopes: { original: [[4, 20]], modified: [[4, 20]] },
		contextGaps: [
			{ originalStart: 1, originalCount: 4, modifiedStart: 1, modifiedCount: 4, collapsed: true },
			{ originalStart: 21, originalCount: 10, modifiedStart: 21, modifiedCount: 10, collapsed: true },
		],
	};
	assert.deepEqual(shownLines(lensContextGaps(modified, 30, 30, head(15, 15)), 30), [[5, 20]]);
});

test('a lens inside a method added to an existing class shows the scope boundaries, not the whole method', () => {
	// A class on lines 1-60 of both sides. Head adds a method on lines 21-40; the
	// class body around it is unchanged, with lines 2-16 and 45-59 collapsed.
	const rows = [
		...Array.from({ length: 20 }, (_, i) => [i, i] as const),
		...Array.from({ length: 20 }, (_, i) => [null, 20 + i] as const),
		...Array.from({ length: 20 }, (_, i) => [20 + i, 40 + i] as const),
	];
	const diff: IDocumentDiff = {
		...plain,
		changes: [new DetailedLineRangeMapping(new LineRange(21, 21), new LineRange(21, 41), undefined)],
		sourceLineAlignment: rows,
		contextScopes: { original: [[0, 40]], modified: [[0, 60], [20, 40]] },
		contextGaps: [
			{ originalStart: 2, originalCount: 15, modifiedStart: 2, modifiedCount: 15, collapsed: true },
			{ originalStart: 25, originalCount: 15, modifiedStart: 45, modifiedCount: 15, collapsed: true },
		],
	};
	assert.deepEqual(shownLines(lensContextGaps(diff, 40, 60, head(30, 31)), 60), [[1, 1], [17, 21], [27, 34], [40, 44], [60, 60]]);
});

test('viewed folds never hide an unread counterpart, and do not overlap structural folds', async () => {
	const { viewedContextGaps } = await import('./reviewLens.js');
	const range = (side: 'base' | 'head', fromLine: number, toLine: number) => ({ side, file: 'a.ts', fromLine, toLine });
	const changed = [range('base', 3, 5), range('head', 3, 5)];
	assert.deepEqual(viewedContextGaps(plain, 10, 10, [range('head', 3, 5)], changed), []);
	const gaps = viewedContextGaps({ ...plain, contextGaps: [{ originalStart: 2, modifiedStart: 2, originalCount: 5, modifiedCount: 5, label: 'body' }] }, 10, 10, changed, changed);
	assert.equal(gaps.length, 1);
	assert.equal(gaps[0].label, 'Viewed');
	assert.equal(gaps[0].modifiedCount, 3);
});

test('folding an inline scope keeps its header inside a code peek', () => {
	const scope = { originalStart: 21, modifiedStart: 21, originalCount: 19, modifiedCount: 19, foldStateId: 7, band: false };
	const selection = [{ side: 'head' as const, file: 'a.ts', fromLine: 60, toLine: 65 }];
	const project = (collapsed: boolean) => lensContextGaps({
		...plain,
		contextScopes: { original: [[10, 80]], modified: [[10, 80]] },
		contextGaps: [
			{ originalStart: 1, modifiedStart: 1, originalCount: 10, modifiedCount: 10 },
			{ ...scope, collapsed },
			{ originalStart: 81, modifiedStart: 81, originalCount: 20, modifiedCount: 20 },
		],
	}, 100, 100, selection);
	const folded = project(true), expanded = project(false);
	assert.deepEqual(folded.filter(gap => gap.label === 'Outside lens'), expanded.filter(gap => gap.label === 'Outside lens'));
	assert.ok(folded.some(gap => gap.foldStateId === 7));
	assert.ok(!folded.some(gap => gap.label === 'Outside lens' && gap.modifiedStart <= 20 && gap.modifiedStart + gap.modifiedCount > 20));
});

test('an identical file exposes the referenced slice with three surrounding lines', () => {
	const gaps = lensContextGaps({ changes: [], moves: [], identical: true, quitEarly: false }, 30, 30, [
		{ file: 'context.ts', side: 'base', fromLine: 10, toLine: 12 },
		{ file: 'context.ts', side: 'head', fromLine: 10, toLine: 12 },
	]);
	assert.deepEqual(gaps.map(gap => [gap.originalStart, gap.originalCount, gap.modifiedStart, gap.modifiedCount]), [[1, 6, 1, 6], [16, 15, 16, 15]]);
});

// A modified file shaped like a schema declaration, the same on both sides
// except for lines 1-3 and 23-24: an import block on lines 1-11 that diffr
// leaves open, `export const schema = z` / `.strictObject({` on lines 15-16
// opening a scope that closes on line 40, and an unchanged run on lines
// 41-50 that diffr also leaves open. Diffr collapses lines 17-19, 28-39 and
// 51-60.
const schemaDiff = (contextScopes: IDocumentDiff['contextScopes']): IDocumentDiff => ({
	...plain,
	changes: [
		new DetailedLineRangeMapping(new LineRange(1, 4), new LineRange(1, 4), undefined),
		new DetailedLineRangeMapping(new LineRange(23, 25), new LineRange(23, 25), undefined),
	],
	contextScopes,
	contextGaps: [[17, 3], [28, 12], [51, 10]].map(([start, count]) =>
		({ originalStart: start, originalCount: count, modifiedStart: start, modifiedCount: count, collapsed: true })),
});
const schemaScope: [number, number] = [14, 40];

test('a code peek never treats the file as a scope around its pin', () => {
	// A tagged root, as a plugin could leave it, around the schema's scope.
	const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
	const at = (line: number) => ({ line, column: 0 });
	const leaf = (id: number, start: number, end: number): StructuralLeaf =>
		({ id, alignment_id: id, fold_state_id: id, kind: 'leaf', start: at(start), end: at(end) });
	const source = {
		text: lines.join('\n') + '\n',
		root: {
			id: 1, fold_state_id: 1, kind: 'fold' as const, tags: ['context:scope'], start: at(0), end: at(60), indent: at(0), children: [
				leaf(2, 0, 14),
				{ id: 3, fold_state_id: 3, kind: 'fold' as const, tags: ['context:scope'], start: at(14), end: at(40), indent: at(14), children: [leaf(4, 14, 40)] },
				leaf(5, 40, 60),
			],
		},
	};
	const scopes = structuralContextScopes({ type: 'text', stats: { textual: { added: 0, removed: 0 }, visible: { added: 0, removed: 0 } }, structural_changes: { base: [], head: [] }, lhs: source, rhs: source });
	assert.deepEqual(scopes, { original: [schemaScope], modified: [schemaScope] });
	const shown = shownLines(lensContextGaps(schemaDiff(scopes), 60, 60, head(23, 24)), 60);
	assert.ok(shown.every(([from]) => from > 11), JSON.stringify(shown));
});

test('a code peek shows a scope boundary, not the unchanged code beyond it', () => {
	const diff = schemaDiff({ original: [schemaScope], modified: [schemaScope] });
	// The header's second line is kept, as diffr keeps it, up to the first fold.
	assert.deepEqual(shownLines(lensContextGaps(diff, 60, 60, head(23, 24)), 60), [[15, 16], [20, 27], [40, 40]]);
	// A base-side pin projects the same way.
	const base = lensContextGaps(diff, 60, 60, [{ side: 'base', file: 'a.ts', fromLine: 23, toLine: 24 }]);
	assert.deepEqual(shownLines(base, 60), [[15, 16], [20, 27], [40, 40]]);
});

test('a code peek inside nested scopes shows each header and closer, and leaves diffr\'s folds folded', () => {
	// A class on lines 1-40, a method on 6-35, an if on 14-28; the pin is line 21.
	const fold = (start: number, count: number) => ({ originalStart: start, originalCount: count, modifiedStart: start, modifiedCount: count, collapsed: true });
	const diff: IDocumentDiff = {
		...plain,
		changes: [new DetailedLineRangeMapping(new LineRange(21, 22), new LineRange(21, 22), undefined)],
		contextScopes: { original: [[0, 40], [5, 35], [13, 28]], modified: [[0, 40], [5, 35], [13, 28]] },
		contextGaps: [fold(2, 4), fold(7, 7), fold(15, 3), fold(25, 3), fold(29, 6), fold(36, 4)],
	};
	assert.deepEqual(shownLines(lensContextGaps(diff, 40, 40, head(21, 21)), 40), [[1, 1], [6, 6], [14, 14], [18, 24], [28, 28], [35, 35], [40, 40]]);
});

test('a code peek spanning two functions shows both of their boundaries', () => {
	// Functions on lines 3-20 and 22-40, each body collapsed away from the pin on lines 19-23.
	const fold = (start: number, count: number) => ({ originalStart: start, originalCount: count, modifiedStart: start, modifiedCount: count, collapsed: true });
	const diff: IDocumentDiff = {
		...plain,
		changes: [new DetailedLineRangeMapping(new LineRange(19, 24), new LineRange(19, 24), undefined)],
		contextScopes: { original: [[2, 20], [21, 40]], modified: [[2, 20], [21, 40]] },
		contextGaps: [fold(1, 2), fold(4, 12), fold(27, 13)],
	};
	assert.deepEqual(shownLines(lensContextGaps(diff, 40, 40, head(19, 23)), 40), [[3, 3], [16, 26], [40, 40]]);
});
