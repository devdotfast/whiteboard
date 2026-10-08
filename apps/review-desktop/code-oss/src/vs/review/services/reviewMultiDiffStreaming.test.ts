/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import test from 'node:test';
import { Emitter } from '../../base/common/event.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import { ObservablePromise, autorun, observableValue } from '../../base/common/observable.js';
import type { IDocumentDiffItem } from '../../editor/browser/widget/multiDiffEditor/model.js';
import type { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const dom = new JSDOM('<html><body></body></html>');
for (const key of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'Node', 'MutationObserver', 'Element', 'navigator', 'customElements', 'UIEvent', 'MouseEvent', 'KeyboardEvent'] as const) {
	Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
registerHooks({ load(url, context, next) {
	return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
} });
const { MultiDiffEditorViewModel } = await import('../../editor/browser/widget/multiDiffEditor/multiDiffEditorViewModel.js');
const { RefCounted } = await import('../../editor/browser/widget/diffEditor/utils.js');

test('ready files remain interactive while later diffs are still pending', async () => {
	const store = new DisposableStore();
	const changed = store.add(new Emitter<void>());
	const ready = [Promise.withResolvers<void>(), Promise.withResolvers<void>(), Promise.withResolvers<void>()];
	const documents = ready.map(() => store.add(RefCounted.createOfNonDisposable<IDocumentDiffItem>({
		original: undefined, modified: undefined, collapsed: observableValue('collapsed', false),
	}, { dispose() {} })));
	let current = documents.slice(0, 2);
	const model = store.add(new MultiDiffEditorViewModel({
		documents: { get value() { return current; }, onDidChange: changed.event },
	}, { createInstance: (_ctor: unknown, document: typeof documents[number]) => ({
		collapsed: document.object.collapsed,
		waitForInitialDiffOr1s: new ObservablePromise(ready[documents.indexOf(document)].promise),
		dispose() {},
	}) } as unknown as IInstantiationService));
	store.add(autorun(reader => model.items.read(reader)));
	try {
		ready[0].resolve();
		await ready[0].promise;
		assert.equal(model.items.get().length, 1);
		assert.equal(model.isLoading.get(), true);
		const first = model.items.get()[0];
		model.collapse(first);
		assert.equal(documents[0].object.collapsed.get(), true);
		current = documents;
		changed.fire();
		ready[2].resolve();
		await ready[2].promise;
		assert.equal(model.items.get().length, 2);
		assert.equal(model.items.get()[0], first);
		assert.equal(first.collapsed.get(), true);
		model.expand(first);
		ready[1].resolve();
		await ready[1].promise;
		assert.equal(model.items.get().length, 3);
		assert.equal(model.isLoading.get(), false);
		assert.equal(first.collapsed.get(), false);
	} finally {
		for (const file of ready) file.resolve();
		store.dispose();
	}
});
