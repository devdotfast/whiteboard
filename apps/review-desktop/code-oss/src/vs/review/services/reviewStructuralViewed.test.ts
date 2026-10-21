import assert from 'node:assert/strict';
import test from 'node:test';
import { Emitter } from '../../base/common/event.js';
import { StructuralViewedState } from './reviewStructuralViewed.js';
import type { ReviewDiffProgress, StructuralRegion } from '../common/reviewProtocol.js';

function fixture() {
	const child = (id: number, start: number, end: number, children: StructuralRegion[] = []): StructuralRegion => ({
		kind: 'fold', id, fold_state_id: id, indent: { line: start, column: 0 }, start: { line: start, column: 0 }, end: { line: end, column: 0 },
		syntax: { start: { line: start - 1, column: 4 }, end: { line: end, column: 0 } }, children,
	});
	const root = child(0, 0, 12, [child(1, 1, 10, [child(2, 3, 6)])]);
	const source = { root, text: '\n'.repeat(12) };
	const change = new Emitter<void>();
	const sessionChange = new Emitter<{ files: ReadonlySet<string>; status: boolean }>();
	const calls: [number, boolean][] = [];
	const session = { diff: { type: 'text', lhs: source, rhs: source }, onDidChange: sessionChange.event, getTextDiff: () => session.diff, setRegionCollapsed: (_path: string, id: number, closed: boolean) => calls.push([id, closed]) };
	const ranges = [{ side: 'head' as const, file: 'a.ts', fromLine: 4, toLine: 4 }];
	const progress: ReviewDiffProgress = { files: [{ path: 'a.ts', state: 'unread', total: { additions: 1, deletions: 0 }, remaining: { additions: 1, deletions: 0 }, changedRanges: ranges, viewedRanges: [] }] };
	const make = () => new StructuralViewedState(session as never, [{ file: { path: 'a.ts' } }] as never, () => progress, change.event);
	return { make, calls, progress, ranges, change, sessionChange, session, child };
}

test('a fresh diff folds outermost viewed scopes without rewriting inner fold choices', () => {
	const f = fixture(); f.progress.files[0].viewedRanges = f.ranges;
	const state = f.make();
	try { assert.deepEqual(f.calls.slice(), [[1, true]]); }
	finally { state.dispose(); f.change.dispose(); f.sessionChange.dispose(); }
});

test('a diffr update recomputes the file\'s viewed scopes', () => {
	const f = fixture();
	const state = f.make();
	try {
		assert.equal(state.get('a.ts', 2).total.additions, 1);
		const updated = { ...f.session.diff.rhs, root: f.child(0, 0, 12, [f.child(1, 1, 10)]) };
		f.session.diff = { type: 'text', lhs: updated, rhs: updated };
		f.sessionChange.fire({ files: new Set(['a.ts']), status: false });
		assert.equal(state.get('a.ts', 2).total.additions, 0);
	} finally { state.dispose(); f.change.dispose(); f.sessionChange.dispose(); }
});
