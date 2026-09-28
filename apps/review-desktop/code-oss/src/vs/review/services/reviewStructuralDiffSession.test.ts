import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuralDiffSession } from './reviewStructuralDiffSession.js';
import type { StructuralEvent } from '../common/reviewStructuralDiff.js';

const file = { rhs: { path: 'a.ts', oid: 'abc', mode: '100644' } };
const start: StructuralEvent = { type: 'start', version: 4, lhs: { type: 'empty_tree' }, rhs: { type: 'revision', rev: 'head' }, files: [{ file, status: 'added' }] };
const result: StructuralEvent = { type: 'file', file, diff: { type: 'text', structural_changes: { base: [], head: [[0, 1]] }, rhs: { text: 'a', regions: [{ kind: 'leaf', id: 1, fold_state_id: 2, alignment_id: 1, start: { line: 0, column: 0 }, end: { line: 0, column: 1 }, visibility: { collapsed: true } }] }, stats: { textual: { added: 1, removed: 0 }, visible: { added: 0, removed: 0 } } } };
const complete: StructuralEvent = { type: 'complete', succeeded: 1, failed: 0 };

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
	try { await session.start(); assert.equal(session.getFileResult('a.ts')?.error, 'bad file'); assert.match(session.error!, /stopped/); }
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

test('deferred annotations retain source identity, counts and user fold choices', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => release = resolve);
	const session = new StructuralDiffSession({
		async *streamComparison() {
			yield start; yield structuredClone(result);
			await gate;
			yield { type: 'annotations', file, annotations: [{ region_id: 1, label: 'summarized' }] } as StructuralEvent;
			yield complete;
		}
	});
	const task = session.start();
	while (!session.getTextDiff('a.ts')) await new Promise(resolve => setTimeout(resolve, 0));
	try {
		const initial = session.getTextDiff('a.ts')!;
		assert.equal(session.complete, false);
		session.setRegionCollapsed('a.ts', 2, false);
		release(); await task;
		assert.equal(session.getTextDiff('a.ts'), initial);
		assert.equal(initial.rhs!.regions![0].visibility?.label, 'summarized');
		assert.equal(initial.rhs!.text, 'a');
		assert.deepEqual(initial.structural_changes, { base: [], head: [[0, 1]] });
		assert.equal(session.isRegionCollapsed('a.ts', 2), false);
		assert.equal(session.error, undefined);
	} finally { release(); session.dispose(); }
});

test('invalid annotation batches are atomic and enrichment failure keeps the initial diff usable', async () => {
	for (const invalid of [false, true]) {
		const session = new StructuralDiffSession({
			async *streamComparison() {
				yield start; yield structuredClone(result);
				yield {
					type: 'annotations', file,
					annotations: invalid ? [{ region_id: 1, label: 'must not apply' }, { region_id: 99, label: 'bad' }] : [],
					error: invalid ? undefined : { code: 'enrichment_failed', message: 'offline' },
				} as StructuralEvent;
				yield complete;
			}
		});
		try {
			await session.start();
			assert.equal(session.getTextDiff('a.ts')!.rhs!.regions![0].visibility?.label, undefined);
			assert.equal(session.isRegionCollapsed('a.ts', 2), true);
			if (invalid) assert.match(session.error!, /Unknown annotation region/);
			else {
				assert.equal(session.getFileResult('a.ts')?.annotationError, 'offline');
				assert.equal(session.error, undefined);
			}
		} finally { session.dispose(); }
	}
});

test('streamed labels update existing bands without invalidating either file provider', async () => {
	const { StructuralDiffProvider } = await import('./reviewStructuralDiff.js');
	const { URI } = await import('../../base/common/uri.js');
	const { CancellationToken } = await import('../../base/common/cancellation.js');
	const other = { rhs: { path: 'b.ts', oid: 'def', mode: '100644' } };
	let release!: () => void;
	const gate = new Promise<void>(resolve => release = resolve);
	const session = new StructuralDiffSession({
		async *streamComparison() {
			yield { ...start, files: [...start.files, { file: other, status: 'added' as const }] };
			yield structuredClone(result);
			yield { ...structuredClone(result), file: other };
			await gate;
			yield { type: 'annotations', file, annotations: [{ region_id: 1, label: 'first' }] } as StructuralEvent;
			yield { type: 'annotations', file, annotations: [{ region_id: 1, label: '// pseudocode\nfinal summary' }] } as StructuralEvent;
			yield { ...complete, succeeded: 2 };
		}
	});
	const task = session.start();
	const ready = new Promise<void>(resolve => {
		const sub = session.onDidChange(change => { if (change.files.has('b.ts')) { sub.dispose(); resolve(); } });
	});
	try {
		await ready;
		const models = (path: string) => [
			{ uri: URI.parse(`test:/base/${path}`), getLinesContent: () => [''] },
			{ uri: URI.parse(`test:/head/${path}`), getLinesContent: () => ['a'] },
		] as const;
		const a = models('a.ts'), b = models('b.ts');
		const pairs = new Map([[`${a[0].uri}\n${a[1].uri}`, 'a.ts'], [`${b[0].uri}\n${b[1].uri}`, 'b.ts']]);
		const pa = new StructuralDiffProvider(session, pairs, new Set());
		const pb = new StructuralDiffProvider(session, pairs, new Set());
		const compute = (provider: typeof pa, pair: ReturnType<typeof models>) => provider.computeDiff(
			pair[0] as Parameters<typeof provider.computeDiff>[0], pair[1] as Parameters<typeof provider.computeDiff>[1],
			{ ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false }, CancellationToken.None,
		);
		const diff = await compute(pa, a);
		await compute(pb, b);
		let invalidationsA = 0, invalidationsB = 0, labelBatches = 0;
		const subscriptions = [pa.onDidChange(() => invalidationsA++), pb.onDidChange(() => invalidationsB++),
		session.onDidChange(change => { if (change.labels.has('a.ts')) labelBatches++; })];
		const band = diff.contextGaps![0];
		release(); await task;
		assert.equal(band.labelObservable!.get(), '// pseudocode\nfinal summary');
		assert.equal(invalidationsA, 0);
		assert.equal(invalidationsB, 0);
		assert.equal(labelBatches, 1, 'a burst publishes only the latest presentation state');
		const folded = new Promise<void>(resolve => {
			const sub = pa.onDidChange(() => { sub.dispose(); resolve(); });
		});
		session.setRegionCollapsed('a.ts', 2, false);
		await folded;
		assert.equal(invalidationsA, 1);
		assert.equal(invalidationsB, 0, 'folding a file does not invalidate unrelated editors');
		subscriptions.forEach(sub => sub.dispose());
	} finally { release(); session.dispose(); await task; }
});

test('structural editor models retain diffr bytes across a live file save', async () => {
	const { createStructuralDiffEditors, StructuralDiffProvider } = await import('./reviewStructuralDiff.js');
	const { URI } = await import('../../base/common/uri.js');
	const { DisposableStore } = await import('../../base/common/lifecycle.js');
	const { CancellationToken } = await import('../../base/common/cancellation.js');
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
			type: 'text', lhs: { text: 'base\n' }, rhs: { text: 'saved A\n' },
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
	const editors = { onDiffEditorAdd: () => ({ dispose() {} }), listDiffEditors: () => [] };
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
		const provider = new StructuralDiffProvider(session, pairs, new Set());
		await assert.doesNotReject(provider.computeDiff(left as never, right as never,
			{ ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false }, CancellationToken.None));
		await task;
	} finally { release(); lifetime.dispose(); session.dispose(); await task; }
});
