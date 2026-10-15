/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore, toDisposable } from "../../base/common/lifecycle.js";
import type { ICodeEditor, IGlyphMarginWidget } from "../../editor/browser/editorBrowser.js";
import { ICodeEditorService } from "../../editor/browser/services/codeEditorService.js";
import { Range } from "../../editor/common/core/range.js";
import { GlyphMarginLane } from "../../editor/common/model.js";
import type { ReviewAskMark, ReviewAskPinMount } from "../common/reviewProtocol.js";
import { REVIEW_API_SOURCE_SCHEME, sourceLocation } from "../common/reviewSourceView.js";

let widgets = 0;

/** Pins saved Ask conversations in the gutter of one view's editors, including ones mounted later. */
export class ReviewAskMarks extends Disposable {
	private marks: readonly ReviewAskMark[] = [];
	private mount: ReviewAskPinMount | undefined;
	private readonly watched = this._register(new DisposableMap<ICodeEditor, DisposableStore>());
	private readonly painted = this._register(new DisposableMap<ICodeEditor, DisposableStore>());
	private readonly shown = new Map<ICodeEditor, string>();

	constructor(private readonly container: HTMLElement, @ICodeEditorService editors: ICodeEditorService) {
		super();
		this._register(editors.onCodeEditorAdd(editor => this.watch(editor)));
		this._register(editors.onCodeEditorRemove(editor => { this.clear(editor); this.watched.deleteAndDispose(editor); }));
		for (const editor of editors.listCodeEditors()) this.watch(editor);
	}

	set(marks: readonly ReviewAskMark[], mount: ReviewAskPinMount): void {
		this.marks = marks;
		this.mount = mount;
		for (const editor of this.watched.keys()) { this.clear(editor); this.paint(editor); }
	}

	private clear(editor: ICodeEditor): void {
		this.painted.deleteAndDispose(editor);
		this.shown.delete(editor);
	}

	private watch(editor: ICodeEditor): void {
		const store = new DisposableStore();
		store.add(editor.onDidChangeModel(() => this.paint(editor)));
		store.add(editor.onDidChangeHiddenAreas(() => this.paint(editor)));
		this.watched.set(editor, store);
		this.paint(editor);
	}

	private paint(editor: ICodeEditor): void {
		const marks = this.place(editor);
		// A reused editor fires model and fold events in turn.
		const key = marks.map(mark => mark.id).join() + `|${editor.getModel()?.id}`;
		if (this.shown.get(editor) === key) return;
		this.clear(editor);
		this.shown.set(editor, key);
		const mount = this.mount;
		if (!marks.length || !mount) return;
		this.painted.set(editor, this.draw(editor, marks, mount));
	}

	private place(editor: ICodeEditor): ReviewAskMark[] {
		const uri = editor.getModel()?.uri;
		// Every view's editors register globally; only this view's own are pinned.
		if (!uri || uri.scheme !== REVIEW_API_SOURCE_SCHEME || !this.mount || !this.container.contains(editor.getContainerDomNode())) return [];
		const { file, side } = sourceLocation(uri);
		// The editor would put a pin for lines it hides beside the next line it shows.
		const hidden = editor._getViewModel()?.getHiddenAreas() ?? [];
		return this.marks.filter(mark => mark.file === file && mark.side === side
			&& !hidden.some(area => area.startLineNumber <= mark.fromLine && mark.toLine <= area.endLineNumber));
	}

	private draw(editor: ICodeEditor, marks: readonly ReviewAskMark[], mount: ReviewAskPinMount): DisposableStore {
		const store = new DisposableStore();
		const lines = editor.createDecorationsCollection(marks.flatMap(mark => [{
			range: new Range(mark.fromLine, 1, mark.toLine, 1),
			options: { description: "review-ask", isWholeLine: true, className: "review-ask-code", marginClassName: "review-ask-lines" },
		}, {
			// A second lane beside the pin doubles the gutter's width, which is a line height per lane.
			range: new Range(mark.fromLine, 1, mark.toLine, 1),
			options: { description: "review-ask-lane", glyphMarginClassName: "review-ask-lane", glyphMargin: { position: GlyphMarginLane.Right } },
		}]));
		store.add(toDisposable(() => lines.clear()));
		for (const mark of marks) store.add(this.pin(editor, mark, mount));
		return store;
	}

	private pin(editor: ICodeEditor, mark: ReviewAskMark, mount: ReviewAskPinMount) {
		const node = document.createElement("div");
		node.className = "review-ask-pin";
		// The editor would otherwise move the cursor to the line under the click.
		node.addEventListener("mousedown", event => event.stopPropagation());
		const unmount = mount(mark.id, node);
		const id = `review-ask-${++widgets}`;
		const widget: IGlyphMarginWidget = {
			getId: () => id,
			getDomNode: () => node,
			getPosition: () => ({ lane: GlyphMarginLane.Left, zIndex: 10, range: new Range(mark.fromLine, 1, mark.toLine, 1) }),
		};
		editor.addGlyphMarginWidget(widget);
		return toDisposable(() => { editor.removeGlyphMarginWidget(widget); unmount(); });
	}
}
