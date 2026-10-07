import assert from 'node:assert/strict';
import test from 'node:test';
import { structuralViewedProgress, structuralViewedRanges, structuralViewedScopes } from './reviewStructuralViewed.js';
import type { ReviewDiffProgressFile, StructuralRegion } from './reviewProtocol.js';
import type { StructuralTextDiff } from './reviewStructuralDiff.js';

const range = (side: 'base' | 'head', fromLine: number, toLine = fromLine) => ({ side, file: side === 'base' ? 'old.ts' : 'new.ts', fromLine, toLine });
const file: ReviewDiffProgressFile = {
	path: 'new.ts', state: 'unread', remaining: { additions: 3, deletions: 1 }, total: { additions: 3, deletions: 1 },
	changedRanges: [range('head', 4), range('head', 6), range('head', 9), range('base', 5)], viewedRanges: [],
};

test('lens marks mute covered changes in partial scopes and outside foldable syntax', () => {
	const outer = [range('head', 2, 8), range('base', 2, 8)];
	const scopes = new Map([[1, outer]]);
	const partial = { ...file, viewedRanges: [range('head', 4), range('head', 9)] };
	assert.equal(structuralViewedProgress(outer, partial).state, 'partial');
	assert.deepEqual(structuralViewedRanges(scopes, partial), [range('head', 4), range('head', 9)]);
	assert.deepEqual(structuralViewedRanges(scopes, { ...file, viewedRanges: outer }), [range('base', 2, 8), range('head', 2, 8)], 'a fully viewed scope also mutes its surrounding syntax');
	assert.deepEqual(structuralViewedRanges(scopes, file), [], 'unmarking restores the code styling');
});

test('nested viewed coverage leaves outer remaining counts and neighboring scopes intact', () => {
	const outer = [range('head', 2, 8), range('base', 2, 8)];
	const inner = [range('head', 6), range('base', 6)];
	const progress = { ...file, viewedRanges: inner };
	assert.equal(structuralViewedProgress(inner, progress).state, 'viewed');
	assert.deepEqual(structuralViewedProgress(outer, progress), {
		state: 'partial', total: { additions: 2, deletions: 1 }, remaining: { additions: 1, deletions: 1 },
	});
	assert.equal(structuralViewedProgress([range('head', 9)], progress).state, 'unread');
	assert.equal(structuralViewedProgress(outer, { ...file, viewedRanges: outer }).state, 'viewed');
	assert.equal(structuralViewedProgress(outer, file).state, 'unread', 'unmarking restores unread coverage');
});

test('overlapping marks count once, and unchanged scopes have nothing to mark', () => {
	const sources = [range('head', 2, 8), range('head', 4, 7), range('base', 2, 8)];
	const progress = { ...file, viewedRanges: [range('head', 4, 6), range('head', 6), range('base', 5)] };
	assert.deepEqual(structuralViewedProgress(sources, progress), {
		state: 'viewed', total: { additions: 2, deletions: 1 }, remaining: { additions: 0, deletions: 0 },
	});
	assert.equal(structuralViewedProgress([range('head', 7, 8)], progress).total.additions, 0);
});

test('one fold mark covers its bundled comment and body on both paths of a rename', () => {
	const fold = (id: number, start: number, end: number, children: StructuralRegion[] = []): StructuralRegion => ({
		kind: 'fold', id, fold_state_id: id, indent: { line: start, column: 0 }, start: { line: start, column: 0 }, end: { line: end, column: 0 }, children,
	});
	const comment = fold(1, 0, 2);
	const body = { ...fold(1, 3, 6), syntax: { start: { line: 2, column: 10 }, end: { line: 6, column: 0 } } };
	const source = { text: '', root: fold(0, 0, 7, [comment, body]) };
	const diff = { type: 'text', lhs: source, rhs: source } as StructuralTextDiff;
	assert.deepEqual(structuralViewedScopes(diff, 'new.ts', 'old.ts').get(1), [range('base', 1, 7), range('head', 1, 7)]);
	assert.equal(structuralViewedScopes(diff, 'new.ts').has(0), false, 'the file header owns the root');
});
