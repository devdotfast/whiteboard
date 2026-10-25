/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Emitter } from '../../base/common/event.js';
import type { URI } from '../../base/common/uri.js';
import type { ICodeEditor, IDiffEditor, IGlyphMarginWidget } from '../../editor/browser/editorBrowser.js';
import type { ICodeEditorService } from '../../editor/browser/services/codeEditorService.js';
import type { ReviewAskMark } from '../common/reviewProtocol.js';
import { apiSourceUri } from '../common/reviewSourceView.js';

// jsdom ships no types here; the DOM globals below are all this test reads from it.
const { JSDOM } = createRequire(import.meta.url)('jsdom');
const dom = new JSDOM('<html><body></body></html>');
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'customElements'] as const) {
	Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
const { ReviewAskMarks, inlineHeadLine } = await import('./reviewAskMarks.js');

const view = { reviewId: 'review', version: 3 };
const source = (file: string, side: 'base' | 'head') => apiSourceUri({ view, side, file });

function editor(uri: URI | undefined, parent: HTMLElement, text: string[] = []) {
	const modelChanged = new Emitter<void>();
	const node = document.createElement('div');
	parent.append(node);
	const widgets = new Map<string, IGlyphMarginWidget>();
	let lines: string[] = [];
	const fake = {
		getModel: () => uri ? { id: uri.toString(), uri, getLineCount: () => text.length, getLineContent: (line: number) => text[line - 1] } : null,
		getContainerDomNode: () => node,
		onDidChangeModel: modelChanged.event,
		onDidChangeHiddenAreas: new Emitter<void>().event,
		_getViewModel: () => ({ getHiddenAreas: () => [] }),
		createDecorationsCollection: (decorations: { range: { startLineNumber: number; endLineNumber: number }; options: { isWholeLine?: boolean } }[]) => {
			lines = decorations.filter(d => d.options.isWholeLine).map(d => `${d.range.startLineNumber}-${d.range.endLineNumber}`);
			return { clear: () => { lines = []; } };
		},
		addGlyphMarginWidget: (widget: IGlyphMarginWidget) => widgets.set(widget.getId(), widget),
		removeGlyphMarginWidget: (widget: IGlyphMarginWidget) => widgets.delete(widget.getId()),
	};
	return {
		fake: fake as unknown as ICodeEditor,
		pins: () => [...widgets.values()].map(w => `${w.getPosition().range.startLineNumber}:${w.getDomNode().textContent}`),
		lines: () => lines,
		swapModel: (next: URI | undefined) => { uri = next; modelChanged.fire(); },
	};
}

function service() {
	const added = new Emitter<ICodeEditor>();
	const removed = new Emitter<ICodeEditor>();
	const editors: ICodeEditor[] = [];
	return {
		fake: {
			onCodeEditorAdd: added.event, onCodeEditorRemove: removed.event, listCodeEditors: () => editors,
			onDiffEditorAdd: new Emitter<IDiffEditor>().event, onDiffEditorRemove: new Emitter<IDiffEditor>().event, listDiffEditors: () => [],
		} as unknown as ICodeEditorService,
		add: (editor: ICodeEditor) => { editors.push(editor); added.fire(editor); },
		remove: (editor: ICodeEditor) => { editors.splice(editors.indexOf(editor), 1); removed.fire(editor); },
	};
}

const mark = (id: string, file: string, side: 'base' | 'head', fromLine: number, toLine = fromLine): ReviewAskMark => ({ id, file, side, fromLine, toLine });

test('pins marks beside their lines in this view\'s editors showing their file and side, including late ones', () => {
	const container = document.createElement('div');
	const elsewhere = document.createElement('div');
	const editors = service();
	const head = editor(source('src/a.ts', 'head'), container);
	const base = editor(source('src/a.ts', 'base'), container);
	// The same file in another view, such as a peek while the Diff tab is open.
	const other = editor(source('src/a.ts', 'head'), elsewhere);
	for (const e of [head, base, other]) editors.add(e.fake);

	const mounted = new Set<string>();
	const marks = new ReviewAskMarks(container, false, editors.fake, { isMotionReduced: () => true } as never);
	marks.set([mark('one', 'src/a.ts', 'head', 4, 6), mark('two', 'src/a.ts', 'base', 9), mark('three', 'src/b.ts', 'head', 2)], (id, node) => {
		node.textContent = id;
		mounted.add(id);
		return () => mounted.delete(id);
	});

	assert.deepEqual(head.pins(), ['4:one']);
	assert.deepEqual(head.lines(), ['4-6']);
	assert.deepEqual(base.pins(), ['9:two']);
	assert.deepEqual(other.pins(), []);

	// The multi-diff reuses an editor for the next file as it scrolls.
	const late = editor(source('src/b.ts', 'head'), container);
	editors.add(late.fake);
	assert.deepEqual(late.pins(), ['2:three']);
	head.swapModel(source('src/c.ts', 'head'));
	assert.deepEqual(head.pins(), []);
	assert.deepEqual(head.lines(), []);
	assert.deepEqual([...mounted].sort(), ['three', 'two']);

	editors.remove(base.fake);
	assert.deepEqual([...mounted], ['three']);

	marks.dispose();
	assert.deepEqual(late.pins(), []);
	assert.deepEqual([...mounted], []);
});

// Base lines 3–4 became head line 3; head lines 5–6 were added after base
// line 5; base line 8 was removed after head line 8.
const changes = [
	{ originalStartLineNumber: 3, originalEndLineNumber: 4, modifiedStartLineNumber: 3, modifiedEndLineNumber: 3 },
	{ originalStartLineNumber: 5, originalEndLineNumber: 0, modifiedStartLineNumber: 5, modifiedEndLineNumber: 6 },
	{ originalStartLineNumber: 8, originalEndLineNumber: 8, modifiedStartLineNumber: 8, modifiedEndLineNumber: 0 },
];

test('finds the head line an inline diff draws each base line beside', () => {
	assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(line => inlineHeadLine(line, changes)), [1, 2, 3, 3, 4, 7, 8, 8, 9]);
});

test('marks no lines that read otherwise than when asked about', () => {
	const container = document.createElement('div');
	const head = editor(source('src/a.ts', 'head'), container, ['a', 'b', 'c']);
	const editors = service();
	editors.add(head.fake);

	const marks = new ReviewAskMarks(container, false, editors.fake, { isMotionReduced: () => true } as never);
	marks.set([
		{ ...mark('same', 'src/a.ts', 'head', 2, 3), text: ['b', 'c'] },
		{ ...mark('edited', 'src/a.ts', 'head', 1), text: ['x'] },
		{ ...mark('gone', 'src/a.ts', 'head', 3, 4), text: ['c', 'd'] },
	], (id, node) => {
		node.textContent = id;
		return () => { };
	});
	assert.deepEqual(head.pins(), ['2:same']);
	marks.dispose();
});

test('compact lanes follow only this view’s visible pins and keep their width for additional pins', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    const editors = service();
    const head = editor(source('src/a.ts', 'head'), container, ['a', 'b', 'c']);
    const other = editor(source('src/a.ts', 'head'), elsewhere, ['a', 'b', 'c']);
    const changed = new Emitter<{ hasChanged(): boolean }>();
    const widths: number[] = [];
    const hiddenChanged = new Emitter<void>();
    let hidden: Array<{ startLineNumber: number; endLineNumber: number }> = [];
    Object.assign(head.fake, {
        _getViewModel: () => ({ getHiddenAreas: () => hidden }),
        onDidChangeHiddenAreas: hiddenChanged.event,
        updateOptions: (options: { glyphMarginWidth: number }) => widths.push(options.glyphMarginWidth),
        getOption: () => 20,
        onDidChangeConfiguration: changed.event,
    });
    editors.add(head.fake); editors.add(other.fake);
    const motion = { isMotionReduced: () => true, onDidChangeReducedMotion: new Emitter<void>().event };
    const marks = new ReviewAskMarks(container, true, editors.fake, motion as never);
    const mount = (id: string, node: HTMLElement) => { node.textContent = id; return () => {}; };
    marks.set([], mount);
    assert.equal(widths.at(-1), 0);
    marks.set([mark('one', 'src/a.ts', 'head', 1)], mount);
    assert.equal(widths.at(-1), 40);
    const afterFirst = widths.length;
    marks.set([mark('one', 'src/a.ts', 'head', 1), mark('two', 'src/a.ts', 'head', 3)], mount);
    assert.equal(widths.length, afterFirst);
    marks.set([mark('two', 'src/a.ts', 'head', 3)], mount);
    assert.equal(widths.length, afterFirst);
    assert.deepEqual(other.pins(), []);
    marks.set([], mount);
    assert.equal(widths.at(-1), 0);
    assert.deepEqual(head.pins(), []);
    marks.set([mark('one', 'src/a.ts', 'head', 1)], mount);
    hidden = [{ startLineNumber: 1, endLineNumber: 1 }]; hiddenChanged.fire();
    assert.equal(widths.at(-1), 0);
    hidden = []; hiddenChanged.fire();
    assert.equal(widths.at(-1), 40);
    head.swapModel(source('src/c.ts', 'head'));
    assert.equal(widths.at(-1), 0);
    assert.deepEqual(head.pins(), []);
    marks.dispose(); hiddenChanged.dispose(); container.remove(); elsewhere.remove(); changed.dispose();
});
