import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuralDiffSession } from './reviewStructuralDiffSession.js';
import { STRUCTURAL_WIRE_VERSION, type StructuralEvent, type StructuralRegion } from '../common/reviewStructuralDiff.js';
import { autorun } from '../../base/common/observable.js';

const file = { rhs: { path: 'a.ts', oid: 'abc', mode: '100644' } };
const start: StructuralEvent = { type: 'start', version: STRUCTURAL_WIRE_VERSION, lhs: { type: 'empty_tree' }, rhs: { type: 'revision', rev: 'head' }, files: [{ file, status: 'added' }] };
const result: StructuralEvent = { type: 'file', file, diff: { type: 'text', structural_changes: { base: [], head: [[0, 1]] }, rhs: { text: 'a', root: { kind: 'leaf', id: 1, fold_state_id: 2, alignment_id: 1, start: { line: 0, column: 0 }, end: { line: 0, column: 1 }, visibility: { collapsed: true } } }, stats: { textual: { added: 1, removed: 0 }, visible: { added: 0, removed: 0 } } } };
const complete: StructuralEvent = { type: 'complete', succeeded: 1, failed: 0 };

test('file headers and structural roots share collapse state across views', async () => {
	const session = new StructuralDiffSession({ async *streamComparison() { yield start; yield result; yield complete; } });
	try {
		await session.start();
		const header = session.fileCollapse('a.ts');
		const secondView = session.fileCollapse('a.ts');
		const rendered: boolean[] = [];
		const subscription = autorun(reader => { rendered.push(secondView.read(reader)); });
		try {
			assert.equal(header.get(), true);
			header.set(false, undefined);
			assert.equal(session.isRegionCollapsed('a.ts', 2), false);
			// Headers must update before the session's batched notification.
			session.setRegionCollapsed('a.ts', 2, true);
			assert.equal(header.get(), true);
			secondView.set(false, undefined);
			assert.equal(header.get(), false);
			assert.deepEqual(rendered, [true, false, true, false]);
			assert.throws(() => session.fileCollapse('missing.ts'), /Missing root collapse state/);
		} finally { subscription.dispose(); }
	} finally { session.dispose(); }
});

test('file results supply root visibility and summary labels before comparison completion', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => release = resolve);
	const labeled = structuredClone(result);
	if (labeled.type !== 'file' || labeled.diff?.type !== 'text') throw new Error('Invalid fixture');
	labeled.diff.rhs!.root.visibility = { collapsed: true, label: 'Generated file' };
	const session = new StructuralDiffSession({ async *streamComparison() { yield start; yield labeled; await gate; yield complete; } });
	const task = session.start();
	try {
		const fileResult = await session.fileResult('a.ts');
		assert.equal(fileResult.hidden, 'Generated file');
		assert.equal(session.complete, false);
		session.setRegionCollapsed('a.ts', 2, false);
		release(); await task;
		assert.equal(session.isRegionCollapsed('a.ts', 2), false);
		assert.equal(session.error, undefined);
	} finally { release(); session.dispose(); await task; }
});

test('views detach and reattach without restarting a comparison or losing folds', async () => {
	let requests = 0;
	const session = new StructuralDiffSession({ async *streamComparison() { requests++; yield start; yield result; yield complete; } });
	try {
		let observedFile = false;
		const view = session.onDidChange(change => { if (change.files.has("a.ts")) observedFile = !!session.getFileResult("a.ts"); });
		await session.start();
		assert.equal(observedFile, true);
		view.dispose();
		session.setRegionCollapsed('a.ts', 2, false);
		await session.start();
		assert.equal(requests, 1);
		assert.equal(session.isRegionCollapsed('a.ts', 2), false);
		assert.equal(session.complete, true);
	} finally { session.dispose(); }
});

test('closing the review aborts a running request and ignores late events', async () => {
	let signal: AbortSignal | undefined;
	let release!: () => void;
	const gate = new Promise<void>(resolve => release = resolve);
	const session = new StructuralDiffSession({ async *streamComparison(s) { signal = s; yield start; await gate; yield result; } });
	const task = session.start();
	await Promise.resolve();
	session.dispose();
	assert.equal(signal?.aborted, true);
	release(); await task;
	assert.equal(session.getFileResult('a.ts'), undefined);
});

test('per-file failures and run abortion remain observable after the stream finishes', async () => {
	const session = new StructuralDiffSession({
		async *streamComparison() {
			yield start;
			yield { type: 'file', file, error: { code: 'parse', message: 'bad file' } } as StructuralEvent;
			yield { ...complete, aborted: { code: 'cancel', message: 'stopped' } } as StructuralEvent;
		}
	});
	try { await session.start(); assert.equal(session.getFileResult('a.ts')?.error, 'bad file'); assert.match(session.error!, /stopped/); assert.deepEqual(session.failure(), { reason: 'aborted', files: 1 }); }
	finally { session.dispose(); }
});

test('truncation and missing manifest results are visible to later subscribers', async () => {
	for (const events of [[start], [start, complete]]) {
		const session = new StructuralDiffSession({ async *streamComparison() { yield* events; } });
		try {
			await session.start();
			assert.equal(session.complete, true);
			assert.ok(session.error || session.getFileResult('a.ts')?.error);
		} finally { session.dispose(); }
	}
});

test('structural editor models retain diffr bytes across a live file save', async () => {
	const { createStructuralDiffEditors, StructuralDiffProvider } = await import('./reviewStructuralDiff.js');
	const { URI } = await import('../../base/common/uri.js');
	const { DisposableStore } = await import('../../base/common/lifecycle.js');
	const { CancellationToken } = await import('../../base/common/cancellation.js');
	const { Event } = await import('../../base/common/event.js');
	const { IModelService } = await import('../../editor/common/services/model.js');
	const { ITextModelService } = await import('../../editor/common/services/resolverService.js');
	const { ILanguageService } = await import('../../editor/common/languages/language.js');
	const { ICodeEditorService } = await import('../../editor/browser/services/codeEditorService.js');
	let release!: () => void;
	const gate = new Promise<void>(resolve => release = resolve);
	const changedFile = { lhs: { path: 'a.ts', oid: 'base', mode: '100644' }, rhs: { path: 'a.ts', oid: 'head', mode: '100644' } };
	const session = new StructuralDiffSession({ async *streamComparison() {
		yield { ...start, files: [{ file: changedFile, status: 'modified' }] } as StructuralEvent;
		await gate;
		yield { type: 'file', file: changedFile, diff: {
			type: 'text', lhs: { text: 'base\n', root: {kind:'leaf',id:3,fold_state_id:3,alignment_id:1,start:{line:0,column:0},end:{line:1,column:0}} }, rhs: { text: 'saved A\n', root: {kind:'leaf',id:4,fold_state_id:4,alignment_id:1,start:{line:0,column:0},end:{line:1,column:0}} },
			structural_changes: { base: [[0, 1]], head: [[0, 1]] },
			stats: { textual: { added: 1, removed: 1 }, visible: { added: 1, removed: 1 } },
		} } as StructuralEvent;
		yield complete;
	} });
	const models = new Map<string, { uri: ReturnType<typeof URI.parse>; value: string; getValue(): string; getLinesContent(): string[] }>();
	let snapshotProvider: { provideTextContent(uri: ReturnType<typeof URI.parse>): Promise<unknown> | null } | undefined;
	const modelService = {
		getModel: (uri: ReturnType<typeof URI.parse>) => models.get(uri.toString()) ?? null,
		createModel: (value: string, _language: unknown, uri: ReturnType<typeof URI.parse>) => {
			const model = { uri, value, getValue() { return this.value; }, getLinesContent() { return this.value.split('\n'); } };
			models.set(uri.toString(), model);
			return model;
		},
	};
	const resolver = { registerTextModelContentProvider: (scheme: string, provider: typeof snapshotProvider) => {
		if (scheme === 'review-api-source') snapshotProvider = provider;
		return { dispose() {} };
	} };
	const editors = { onDiffEditorAdd: () => ({ dispose() {} }), onDiffEditorRemove: () => ({ dispose() {} }), listDiffEditors: () => [] };
	const services = new Map<unknown, unknown>([[IModelService, modelService], [ITextModelService, resolver], [ILanguageService, { createByFilepathOrFirstLine: () => null }], [ICodeEditorService, editors]]);
	const instantiation = { invokeFunction: (fn: (accessor: { get(id: unknown): unknown }) => unknown) => fn({ get: id => services.get(id) }), createChild() { return this; }, dispose() {} };
	const lifetime = new DisposableStore();
	const task = session.start();
	try {
		const original = URI.parse('review-api-source://review/a.ts?side=base');
		const modified = URI.parse('review-api-source://review/a.ts?side=head');
		const entry = { file: { path: 'a.ts', status: 'modified' }, original, modified, goToFileResource: modified };
		const { entries } = createStructuralDiffEditors(instantiation as never, [entry] as never, lifetime, session);
		const leftRequest = snapshotProvider!.provideTextContent(entries[0].original!);
		const rightRequest = snapshotProvider!.provideTextContent(entries[0].modified!);
		assert.ok(leftRequest && rightRequest);
		release();
		const [left, right] = await Promise.all([leftRequest, rightRequest]) as [ReturnType<typeof modelService.createModel>, ReturnType<typeof modelService.createModel>];
		assert.equal(left.getValue(), 'base\n');
		assert.equal(right.getValue(), 'saved A\n');
		// The ordinary live Source model follows a later save; the structural
		// editor keeps the bytes whose alignment diffr supplied.
		const live = modelService.createModel('saved A\n', null, modified);
		live.value = 'saved B\n';
		assert.equal(right.getValue(), 'saved A\n');
		const pairs = new Map([[`${left.uri}\n${right.uri}`, 'a.ts']]);
		const provider = new StructuralDiffProvider(session, pairs, new Set(), Event.None);
		await assert.doesNotReject(provider.computeDiff(left as never, right as never,
			{ ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false }, CancellationToken.None));
		await task;
	} finally { release(); lifetime.dispose(); session.dispose(); await task; }
});

test('a file diffr could not diff resolves to the run\'s error', async () => {
	const session = new StructuralDiffSession({ async *streamComparison() { yield start; throw new Error('diffr exited with 1: boom'); } });
	try {
		const pending = session.fileResult('a.ts');
		await session.start();
		assert.deepEqual(await pending, { error: 'diffr exited with 1: boom' });
	} finally { session.dispose(); }
});

function foldedFile(): StructuralEvent {
	const pos = (line: number) => ({ line, column: 0 });
	const leaf = { kind: 'leaf' as const, id: 3, fold_state_id: 3, alignment_id: 1, start: pos(1), end: pos(2) };
	const body = { kind: 'fold' as const, id: 2, fold_state_id: 2, indent: pos(1), start: pos(1), end: pos(2), children: [leaf] };
	const root = { kind: 'fold' as const, id: 1, fold_state_id: 1, indent: pos(0), start: pos(0), end: pos(3), children: [body] };
	return { type: 'file', file, diff: { type: 'text', structural_changes: { base: [], head: [[0, 3]] }, rhs: { text: 'a\nb\nc\n', root }, stats: { textual: { added: 3, removed: 0 }, visible: { added: 3, removed: 0 } } } };
}
const summary: StructuralEvent = { type: 'update', file, regions: [{ id: 2, collapsed: true, label: 'Sets up a' }], visible: { added: 0, removed: 0 } };
const bodyOf = (session: StructuralDiffSession) => {
	const root = session.getTextDiff('a.ts')!.rhs!.root;
	return root.kind === 'fold' ? root.children[0] : undefined;
};

async function updated(before: (session: StructuralDiffSession) => void, event = summary) {
	let release!: () => void;
	const gate = new Promise<void>(resolve => release = resolve);
	const session = new StructuralDiffSession({ async *streamComparison() { yield start; yield foldedFile(); await gate; yield event; yield complete; } });
	const task = session.start();
	await session.fileResult('a.ts');
	before(session);
	release(); await task;
	assert.equal(session.error, undefined);
	return session;
}

test('an update labels and collapses folds in a file the reader has not seen', async () => {
	const session = await updated(session => session.setRegionCollapsed('a.ts', 3, true, false));
	try {
		assert.deepEqual(bodyOf(session)?.visibility, { collapsed: true, label: 'Sets up a' });
		assert.equal(session.isRegionCollapsed('a.ts', 2), true);
		assert.equal(session.getTextDiff('a.ts')!.stats.visible.added, 0);
	} finally { session.dispose(); }
});

test('an update only labels folds in a file the reader has seen', async () => {
	const session = await updated(session => session.markSeen('a.ts'));
	try {
		assert.deepEqual(bodyOf(session)?.visibility, { label: 'Sets up a' });
		assert.equal(session.isRegionCollapsed('a.ts', 2), false);
	} finally { session.dispose(); }
});

test('a fold the reader toggled keeps its state when an update arrives', async () => {
	const session = await updated(session => session.setRegionCollapsed('a.ts', 2, false));
	try {
		assert.equal(session.isRegionCollapsed('a.ts', 2), false);
		assert.equal(bodyOf(session)?.visibility?.label, 'Sets up a');
	} finally { session.dispose(); }
});

test('a failed update keeps the file\'s diff', async () => {
	const session = await updated(() => {}, { type: 'update', file, error: { code: 'plugin', message: 'summary failed' } });
	try {
		assert.equal(bodyOf(session)?.visibility, undefined);
		assert.equal(session.isRegionCollapsed('a.ts', 2), false);
		assert.equal(session.loadTiming()?.updateErrors, 1);
	} finally { session.dispose(); }
});

test('an update for a file without a result fails the comparison', async () => {
	const session = new StructuralDiffSession({ async *streamComparison() { yield start; yield summary; yield complete; } });
	try {
		await session.start();
		assert.match(session.error!, /Unexpected diffr update: a\.ts/);
	} finally { session.dispose(); }
});

test('load timing reports the first file, and stream completion only when an update arrived', async () => {
	const update: StructuralEvent = { type: 'update', file, regions: [], visible: { added: 1, removed: 0 } };
	const timed = async (events: StructuralEvent[]) => {
		const session = new StructuralDiffSession({ async *streamComparison() { yield* events; } });
		try { await session.start(); return session.loadTiming(); } finally { session.dispose(); }
	};
	const plain = await timed([start, result, complete]);
	assert.equal(plain?.files, 1);
	assert.equal(typeof plain?.firstFileMs, 'number');
	assert.equal(plain?.updatesMs, undefined);
	assert.equal(plain?.updateErrors, 0);
	const updated = await timed([start, result, update, complete]);
	assert.equal(typeof updated?.updatesMs, 'number');
	assert.ok(updated!.updatesMs! >= updated!.firstFileMs);
	assert.equal(await timed([start, complete]), undefined);
});

test('a refresh swaps results in place and keeps folds while the fold tree keeps its shape', async () => {
	const pos = (line: number) => ({ line, column: 0 });
	const leaf = (id: number, line: number): StructuralRegion => ({ kind: 'leaf', id, fold_state_id: id, alignment_id: id, start: pos(line), end: pos(line + 1) });
	const fold = (id: number, children: StructuralRegion[]): StructuralRegion => ({ kind: 'fold', id, fold_state_id: id, indent: pos(0), start: pos(0), end: pos(9), children });
	const diffed = (text: string, root: StructuralRegion) => ({
		async *streamComparison() {
			yield start;
			yield { ...result, diff: { ...result.diff, rhs: { text, root } } } as StructuralEvent;
			yield complete;
		},
	});
	const session = new StructuralDiffSession(diffed('a', fold(1, [fold(2, [leaf(3, 0)])])));
	await session.start();
	session.setRegionCollapsed('a.ts', 2, true);
	const changed: string[][] = [];
	session.onDidChange(change => changed.push([...change.files]));

	await session.refresh(diffed('b', fold(1, [fold(2, [leaf(3, 0)])])));
	assert.equal(session.getTextDiff('a.ts')?.rhs?.text, 'b');
	assert.deepEqual(changed, [['a.ts']]);
	assert.equal(session.isRegionCollapsed('a.ts', 2), true);

	await session.refresh(diffed('c', fold(1, [leaf(4, 0), fold(2, [leaf(3, 1)])])));
	assert.equal(session.isRegionCollapsed('a.ts', 2), false);
	session.dispose();
});

test('overlapping refreshes settle on the last, and a failed one keeps the shown diff', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => release = resolve);
	const diffed = (text: string, stalled = false) => ({
		async *streamComparison() {
			yield start;
			if (stalled) { await gate; throw new Error('diffr exited with 1: stale'); }
			yield { ...result, diff: { ...result.diff, rhs: { ...(result as { diff: { rhs: object } }).diff.rhs, text } } } as StructuralEvent;
			yield complete;
		},
	});
	const session = new StructuralDiffSession(diffed('a', true));
	const first = session.start();
	try {
		const stale = session.refresh(diffed('b', true));
		const latest = session.refresh(diffed('c'));
		assert.equal(session.complete, false);
		await session.start();
		assert.equal(await latest, true);
		assert.equal(session.complete, true);
		assert.equal(session.getTextDiff('a.ts')?.rhs?.text, 'c');
		release();
		assert.equal(await stale, false);
		await first;
		assert.equal(session.error, undefined, 'the first stream failed after the refresh replaced it');

		assert.equal(await session.refresh({ async *streamComparison() { yield start; throw new Error('boom'); } }), false);
		assert.equal(session.getTextDiff('a.ts')?.rhs?.text, 'c');
		assert.equal(session.error, undefined);
	} finally { release(); session.dispose(); }
});

test('a refresh shows its files before diffr\'s deferred updates, which keep the reader\'s folds', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => release = resolve);
	const session = new StructuralDiffSession({ async *streamComparison() { yield start; yield foldedFile(); yield complete; } });
	await session.start();
	session.markSeen('a.ts');
	try {
		const refreshed = session.refresh({ async *streamComparison() { yield start; yield foldedFile(); await gate; yield summary; yield complete; } });
		assert.equal(await Promise.race([refreshed, new Promise(resolve => setTimeout(() => resolve('waited for updates'), 500))]), true);
		assert.equal(bodyOf(session)?.visibility, undefined);
		release();
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.deepEqual(bodyOf(session)?.visibility, { label: 'Sets up a' });
		assert.equal(session.isRegionCollapsed('a.ts', 2), false);
	} finally { release(); session.dispose(); }
});
