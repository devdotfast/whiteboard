import assert from 'node:assert/strict';
import test from 'node:test';
import { Emitter } from '../../base/common/event.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import { URI } from '../../base/common/uri.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import type { IDiffProviderFactoryService } from '../../editor/browser/widget/diffEditor/diffProviderFactoryService.js';
import { IDiffProviderFactoryService as Factory } from '../../editor/browser/widget/diffEditor/diffProviderFactoryService.js';
import type { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import type { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import type { ReviewDiffProgress } from '../common/reviewProtocol.js';
import type { ReviewFilesEditorEntry } from './reviewFilesDiffView.js';
import { withLens } from './reviewLens.js';

test('progress invalidates only relevant file ranges and coalesces a burst', async () => {
	const store = new DisposableStore();
	const progressChanged = store.add(new Emitter<void>());
	const providerChanged = store.add(new Emitter<void>());
	let factory!: IDiffProviderFactoryService;
	const instantiation = {
		invokeFunction: (fn: (accessor: { get(): unknown }) => unknown) => fn({
			get: () => ({
				createDiffProvider: () => ({
					onDidChange: providerChanged.event, computeDiff: async () => ({
						changes: [], moves: [], identical: true, quitEarly: false, sourceLineAlignment: [[0, 0]], contextGaps: [],
					})
				}),
			})
		}),
		createChild: (services: ServiceCollection) => {
			factory = services.get(Factory) as IDiffProviderFactoryService;
			return { dispose() { } };
		},
	} as unknown as IInstantiationService;
	const file = (path: string) => ({
		path, state: 'unread' as const, remaining: { additions: 1, deletions: 0 },
		total: { additions: 1, deletions: 0 }, viewedRanges: [], changedRanges: [],
	});
	let progress: ReviewDiffProgress = { files: [file('a.ts'), file('b.ts')] };
	const original = URI.parse('test:/base/a.ts'), modified = URI.parse('test:/head/a.ts');
	const entry = { original, modified, file: { path: 'a.ts' } } as ReviewFilesEditorEntry;
	withLens(instantiation, [entry], undefined, store, () => progress, progressChanged.event);
	const provider = factory.createDiffProvider({});
	try {
		await provider.computeDiff(
			{ uri: original, getLineCount: () => 1 } as Parameters<typeof provider.computeDiff>[0],
			{ uri: modified, getLineCount: () => 1 } as Parameters<typeof provider.computeDiff>[1],
			{ ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false }, CancellationToken.None,
		);
		let invalidations = 0;
		store.add(provider.onDidChange(() => invalidations++));
		progress = { files: [file('a.ts'), { ...file('b.ts'), viewedRanges: [{ side: 'head', file: 'b.ts', fromLine: 1, toLine: 1 }] }] };
		progressChanged.fire();
		progress.files[0].remaining.additions = 0;
		progressChanged.fire();
		await new Promise(resolve => setTimeout(resolve, 30));
		assert.equal(invalidations, 0, 'other files and counts do not alter this editor’s ranges');
		const notified = new Promise<void>(resolve => {
			const sub = provider.onDidChange(() => { sub.dispose(); resolve(); });
		});
		for (const toLine of [1, 2, 3]) {
			progress.files[0].viewedRanges = [{ side: 'head', file: 'a.ts', fromLine: 1, toLine }];
			progressChanged.fire();
		}
		await notified;
		assert.equal(invalidations, 1);
	} finally { store.dispose(); }
});

test('unmarking a structural scope leaves its child folds under user control', async () => {
	const store = new DisposableStore();
	const changed = store.add(new Emitter<void>());
	let factory!: IDiffProviderFactoryService;
	let collapsed = false;
	const instantiation = {
		invokeFunction: (fn: (accessor: { get(): unknown }) => unknown) => fn({ get: () => ({
			createDiffProvider: () => ({ onDidChange: changed.event, computeDiff: async () => ({
				changes: [], moves: [], identical: false, quitEarly: false,
				sourceLineAlignment: Array.from({ length: 12 }, (_, i) => [i, i]),
				contextGaps: [{ originalStart: 4, modifiedStart: 4, originalCount: 3, modifiedCount: 3, foldStateId: 2, collapsed }],
			}) }),
		}) }),
		createChild: (services: ServiceCollection) => {
			factory = services.get(Factory) as IDiffProviderFactoryService;
			return { dispose() { } };
		},
	} as unknown as IInstantiationService;
	const ranges = [{ side: 'head' as const, file: 'a.ts', fromLine: 2, toLine: 10 }];
	const file: ReviewDiffProgress['files'][number] = {
		path: 'a.ts', state: 'unread', total: { additions: 9, deletions: 0 }, remaining: { additions: 9, deletions: 0 },
		changedRanges: ranges, viewedRanges: [],
	};
	const original = URI.parse('test:/base/a.ts'), modified = URI.parse('test:/head/a.ts');
	withLens(instantiation, [{ original, modified, file: { path: 'a.ts' } } as ReviewFilesEditorEntry], undefined, store, () => ({ files: [file] }), changed.event, true);
	const provider = factory.createDiffProvider({});
	const compute = () => provider.computeDiff(
		{ uri: original, getLineCount: () => 12 } as Parameters<typeof provider.computeDiff>[0],
		{ uri: modified, getLineCount: () => 12 } as Parameters<typeof provider.computeDiff>[1],
		{ ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false }, CancellationToken.None,
	);
	try {
		file.viewedRanges = ranges;
		await compute();
		file.viewedRanges = [];
		file.unfoldRanges = ranges;
		assert.equal((await compute()).contextGaps?.[0].collapsed, false, 'unmarked scope opens');
		collapsed = true;
		assert.equal((await compute()).contextGaps?.[0].collapsed, true, 'a later user fold survives the unmark range');
		collapsed = false;
		assert.equal((await compute()).contextGaps?.[0].collapsed, false, 'the child can reopen too');
	} finally { store.dispose(); }
});
