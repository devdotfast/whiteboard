import assert from 'node:assert/strict';
import test from 'node:test';
import { Emitter } from '../../base/common/event.js';
import { URI } from '../../base/common/uri.js';
import type { ICodeEditor } from '../../editor/browser/editorBrowser.js';
import type { ICodeEditorService } from '../../editor/browser/services/codeEditorService.js';
import { Range } from '../../editor/common/core/range.js';
import { ReviewFindDecorations } from './reviewFindDecorations.js';

function editor(uri: URI | undefined) {
	const modelChanged = new Emitter<void>();
	let shown: string[] = [];
	const fake = {
		getModel: () => uri ? { uri } : null,
		onDidChangeModel: modelChanged.event,
		createDecorationsCollection: (decorations: { range: Range; options: { className: string } }[]) => {
			shown = decorations.map(d => `${d.range.startLineNumber}:${d.options.className}`);
			return { clear: () => { shown = []; } };
		},
	};
	return { fake: fake as unknown as ICodeEditor, shown: () => shown, swapModel: (next: URI | undefined) => { uri = next; modelChanged.fire(); } };
}

function service() {
	const added = new Emitter<ICodeEditor>();
	const removed = new Emitter<ICodeEditor>();
	const editors: ICodeEditor[] = [];
	return {
		fake: { onCodeEditorAdd: added.event, onCodeEditorRemove: removed.event, listCodeEditors: () => editors } as unknown as ICodeEditorService,
		add: (editor: ICodeEditor) => { editors.push(editor); added.fire(editor); },
		remove: (editor: ICodeEditor) => { editors.splice(editors.indexOf(editor), 1); removed.fire(editor); },
	};
}

test('paints matches on editors showing a matched model, including late ones', () => {
	const a = URI.parse('test:/a'), b = URI.parse('test:/b');
	const editors = service();
	const first = editor(a);
	editors.add(first.fake);
	const decorations = new ReviewFindDecorations(editors.fake);
	decorations.set([{ uri: a, range: new Range(1, 1, 1, 2) }, { uri: b, range: new Range(5, 1, 5, 2) }, { uri: a, range: new Range(3, 1, 3, 2) }]);
	decorations.setActive(2);
	assert.deepEqual(first.shown(), ['1:findMatch', '3:currentFindMatch']);

	const late = editor(b);
	editors.add(late.fake);
	assert.deepEqual(late.shown(), ['5:findMatch']);
	late.swapModel(a);
	assert.deepEqual(late.shown(), ['1:findMatch', '3:currentFindMatch']);

	decorations.clear();
	assert.deepEqual(first.shown(), []);
	assert.deepEqual(late.shown(), []);

	editors.remove(first.fake);
	decorations.set([{ uri: a, range: new Range(2, 1, 2, 2) }]);
	assert.deepEqual(first.shown(), []);
	assert.deepEqual(late.shown(), ['2:findMatch']);
	decorations.dispose();
	assert.deepEqual(late.shown(), []);
});
