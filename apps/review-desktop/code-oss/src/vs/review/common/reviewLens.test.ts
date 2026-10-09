import assert from 'node:assert/strict';
import test from 'node:test';
import { lensContextGaps } from './reviewLens.js';
import type { IDocumentContextGap, IDocumentDiff } from '../../editor/common/diff/documentDiffProvider.js';

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
