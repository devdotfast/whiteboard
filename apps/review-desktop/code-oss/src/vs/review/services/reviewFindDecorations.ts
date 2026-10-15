/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from "../../base/common/lifecycle.js";
import type { URI } from "../../base/common/uri.js";
import type { ICodeEditor } from "../../editor/browser/editorBrowser.js";
import { ICodeEditorService } from "../../editor/browser/services/codeEditorService.js";
import type { Range } from "../../editor/common/core/range.js";

export interface FindDecorationTarget {
	uri: URI;
	range: Range;
}

/** Paints find matches on every editor showing a matched model, including ones mounted later. */
export class ReviewFindDecorations extends Disposable {
	private targets: readonly FindDecorationTarget[] = [];
	private byUri = new Map<string, { range: Range; index: number }[]>();
	private active: number | undefined;
	private readonly watched = this._register(new DisposableMap<ICodeEditor, DisposableStore>());
	private readonly painted = new Map<ICodeEditor, { clear(): void }>();

	constructor(@ICodeEditorService editors: ICodeEditorService) {
		super();
		this._register({ dispose: () => this.clear() });
		this._register(editors.onCodeEditorAdd(editor => this.watch(editor)));
		this._register(editors.onCodeEditorRemove(editor => { this.painted.delete(editor); this.watched.deleteAndDispose(editor); }));
		for (const editor of editors.listCodeEditors()) this.watch(editor);
	}

	set(matches: readonly FindDecorationTarget[]): void {
		this.targets = matches;
		this.active = undefined;
		this.byUri = new Map();
		matches.forEach((match, index) => {
			const key = match.uri.toString();
			let list = this.byUri.get(key);
			if (!list) this.byUri.set(key, list = []);
			list.push({ range: match.range, index });
		});
		for (const editor of this.watched.keys()) this.paint(editor);
	}

	setActive(index: number | undefined): void {
		const changed = new Set([this.active, index].flatMap(at => at === undefined || !this.targets[at] ? [] : [this.targets[at].uri.toString()]));
		this.active = index;
		for (const editor of this.watched.keys()) {
			const uri = editor.getModel()?.uri.toString();
			if (uri && changed.has(uri)) this.paint(editor);
		}
	}

	clear(): void {
		this.targets = [];
		this.active = undefined;
		this.byUri = new Map();
		for (const collection of this.painted.values()) collection.clear();
		this.painted.clear();
	}

	private watch(editor: ICodeEditor): void {
		const store = new DisposableStore();
		store.add(editor.onDidChangeModel(() => this.paint(editor)));
		this.watched.set(editor, store);
		this.paint(editor);
	}

	private paint(editor: ICodeEditor): void {
		this.painted.get(editor)?.clear();
		this.painted.delete(editor);
		const uri = editor.getModel()?.uri.toString();
		const matches = uri ? this.byUri.get(uri) : undefined;
		if (!matches?.length) return;
		this.painted.set(editor, editor.createDecorationsCollection(matches.map(match => ({
			range: match.range,
			options: { description: "review-find", className: match.index === this.active ? "currentFindMatch" : "findMatch" },
		}))));
	}
}
