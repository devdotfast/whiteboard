import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuralDiffSession } from './reviewStructuralDiffSession.js';
import { STRUCTURAL_WIRE_VERSION, type StructuralEvent } from '../common/reviewStructuralDiff.js';

const file = { rhs: { path: 'a.ts', oid: 'abc', mode: '100644' } };
const start: StructuralEvent = { type: 'start', version: STRUCTURAL_WIRE_VERSION, lhs: { type: 'empty_tree' }, rhs: { type: 'revision', rev: 'head' }, files: [{ file, status: 'added' }] };
const result: StructuralEvent = { type: 'file', file, diff: { type: 'text', structural_changes: { base: [], head: [[0, 1]] }, rhs: { text: 'a', root: { kind: 'leaf', id: 1, fold_state_id: 2, alignment_id: 1, start: { line: 0, column: 0 }, end: { line: 0, column: 1 }, visibility: { collapsed: true } } }, stats: { textual: { added: 1, removed: 0 }, visible: { added: 0, removed: 0 } } } };
const complete: StructuralEvent = { type: 'complete', succeeded: 1, failed: 0 };

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
		const provider = new StructuralDiffProvider(session, pairs, new Set());
		await assert.doesNotReject(provider.computeDiff(left as never, right as never,
			{ ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false }, CancellationToken.None));
		await task;
	} finally { release(); lifetime.dispose(); session.dispose(); await task; }
});
