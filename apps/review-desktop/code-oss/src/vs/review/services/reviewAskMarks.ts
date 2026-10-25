/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AskPinLane } from "./reviewAskPinLane.js";
import { IAccessibilityService } from "../../platform/accessibility/common/accessibility.js";
import { Disposable, DisposableMap, DisposableStore, toDisposable } from "../../base/common/lifecycle.js";
import type { ICodeEditor, IDiffEditor, IGlyphMarginWidget } from "../../editor/browser/editorBrowser.js";
import { ICodeEditorService } from "../../editor/browser/services/codeEditorService.js";
import { Range } from "../../editor/common/core/range.js";
import type { IChange } from "../../editor/common/diff/legacyLinesDiffComputer.js";
import { GlyphMarginLane, type ITextModel } from "../../editor/common/model.js";
import type { ReviewAskMark, ReviewAskPinMount } from "../common/reviewProtocol.js";
import { REVIEW_API_SOURCE_SCHEME, sourceLocation } from "../common/reviewSourceView.js";

let widgets = 0;

/** The head line an inline diff draws a base line beside. */
export function inlineHeadLine(line: number, changes: readonly IChange[]): number {
	let shift = 0;
	for (const change of changes) {
		const added = change.modifiedEndLineNumber ? change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1 : 0;
		if (!change.originalEndLineNumber) {
			if (change.originalStartLineNumber < line) shift += added;
			continue;
		}
		if (line < change.originalStartLineNumber) break;
		if (line <= change.originalEndLineNumber) return Math.max(1, change.modifiedStartLineNumber);
		shift += added - (change.originalEndLineNumber - change.originalStartLineNumber + 1);
	}
	return line + shift;
}

/** Whether a mark's lines still read as when asked about. */
function unchanged(mark: ReviewAskMark, model: ITextModel | null | undefined): boolean {
	return !mark.text || !!model && mark.text.every((text, index) => {
		const line = mark.fromLine + index;
		return line <= model.getLineCount() && model.getLineContent(line) === text;
	});
}

interface Placed {
	mark: ReviewAskMark;
	fromLine: number;
	toLine: number;
	/** False for a base mark drawn beside a head line. */
	washed: boolean;
}

/** Pins saved Ask conversations in the gutter of one view's editors, including ones mounted later. */
export class ReviewAskMarks extends Disposable {
	private marks: readonly ReviewAskMark[] = [];
	private mount: ReviewAskPinMount | undefined;
	private readonly watched = this._register(new DisposableMap<ICodeEditor, DisposableStore>());
	private readonly painted = this._register(new DisposableMap<ICodeEditor, DisposableStore>());
	private readonly shown = new Map<ICodeEditor, string>();
	private readonly lanes = this._register(new DisposableMap<ICodeEditor, AskPinLane>());
	private readonly diffs = this._register(new DisposableMap<IDiffEditor, DisposableStore>());

	constructor(
        private readonly container: HTMLElement,
        private readonly compactPinLane: boolean,
        @ICodeEditorService private readonly editors: ICodeEditorService,
        @IAccessibilityService private readonly accessibility: IAccessibilityService,
    ) {
		super();
		this._register(editors.onCodeEditorAdd(editor => this.watch(editor)));
		this._register(editors.onCodeEditorRemove(editor => { this.clear(editor); this.lanes.deleteAndDispose(editor); this.watched.deleteAndDispose(editor); }));
		this._register(editors.onDiffEditorAdd(diff => this.watchDiff(diff)));
		this._register(editors.onDiffEditorRemove(diff => this.diffs.deleteAndDispose(diff)));
		for (const diff of editors.listDiffEditors()) this.watchDiff(diff);
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

	private watchDiff(diff: IDiffEditor): void {
		const store = new DisposableStore();
		let sideBySide = diff.renderSideBySide;
		const repaint = () => { for (const editor of [diff.getOriginalEditor(), diff.getModifiedEditor()]) this.paint(editor); };
		store.add(diff.onDidUpdateDiff(repaint));
		// A narrow diff turns inline without making new editors.
		store.add(diff.getModifiedEditor().onDidLayoutChange(() => {
			if (diff.renderSideBySide === sideBySide) return;
			sideBySide = diff.renderSideBySide;
			repaint();
		}));
		this.diffs.set(diff, store);
	}

	private paint(editor: ICodeEditor): void {
		const placed = this.place(editor);
        if (this.compactPinLane && this.container.contains(editor.getContainerDomNode())) {
            let lane = this.lanes.get(editor);
            if (!lane) {
                lane = new AskPinLane(editor, this.accessibility);
                this.lanes.set(editor, lane);
            }
            lane.setHasPins(placed.length > 0);
        } else {
            this.lanes.deleteAndDispose(editor);
        }
		// A reused editor fires model, fold and diff events in turn.
		const key = placed.map(at => `${at.mark.id}@${at.fromLine}-${at.toLine}:${at.washed}`).join() + `|${editor.getModel()?.id}`;
		if (this.shown.get(editor) === key) return;
		this.clear(editor);
		this.shown.set(editor, key);
		const mount = this.mount;
		if (!placed.length || !mount) return;
		this.painted.set(editor, this.draw(editor, placed, mount));
	}

	private place(editor: ICodeEditor): Placed[] {
		const uri = editor.getModel()?.uri;
		// Every view's editors register globally; only this view's own are pinned.
		if (!uri || uri.scheme !== REVIEW_API_SOURCE_SCHEME || !this.mount || !this.container.contains(editor.getContainerDomNode())) return [];
		const { file, side } = sourceLocation(uri);
		const diff = this.editors.listDiffEditors().find(diff => diff.getOriginalEditor() === editor || diff.getModifiedEditor() === editor);
		const inline = diff && !diff.renderSideBySide;
		// An inline diff hides its base editor and draws base lines in the head editor.
		if (inline && side === "base") return [];
		const changes = inline ? diff.getLineChanges() ?? [] : [];
		const base = diff?.getOriginalEditor().getModel();
		const own = this.marks.filter(mark => mark.file === file && mark.side === side && unchanged(mark, editor.getModel()))
			.map((mark): Placed => ({ mark, fromLine: mark.fromLine, toLine: mark.toLine, washed: true }));
		const beside = inline ? this.marks.filter(mark => mark.file === file && mark.side === "base" && unchanged(mark, base))
			.map((mark): Placed => { const line = inlineHeadLine(mark.fromLine, changes); return { mark, fromLine: line, toLine: line, washed: false }; }) : [];
		// The editor would put a pin for lines it hides beside the next line it shows.
		const hidden = editor._getViewModel()?.getHiddenAreas() ?? [];
		return [...own, ...beside].filter(at => !hidden.some(area => area.startLineNumber <= at.fromLine && at.toLine <= area.endLineNumber));
	}

	private draw(editor: ICodeEditor, placed: readonly Placed[], mount: ReviewAskPinMount): DisposableStore {
		const store = new DisposableStore();
		const lines = editor.createDecorationsCollection(placed.flatMap(at => [
			...at.washed ? [{
				range: new Range(at.fromLine, 1, at.toLine, 1),
				options: { description: "review-ask", isWholeLine: true, className: "review-ask-code", marginClassName: "review-ask-lines" },
			}] : [],
			{
				// A second lane beside the pin doubles the gutter's width, which is a line height per lane.
				range: new Range(at.fromLine, 1, at.toLine, 1),
				options: { description: "review-ask-lane", glyphMarginClassName: "review-ask-lane", glyphMargin: { position: GlyphMarginLane.Right } },
			},
		]));
		store.add(toDisposable(() => lines.clear()));
		for (const at of placed) store.add(this.pin(editor, at, mount));
		return store;
	}

	private pin(editor: ICodeEditor, at: Placed, mount: ReviewAskPinMount) {
		const node = document.createElement("div");
		node.className = "review-ask-pin";
		// The editor would otherwise move the cursor to the line under the click.
		node.addEventListener("mousedown", event => event.stopPropagation());
		const unmount = mount(at.mark.id, node);
		const id = `review-ask-${++widgets}`;
		const widget: IGlyphMarginWidget = {
			getId: () => id,
			getDomNode: () => node,
			getPosition: () => ({ lane: GlyphMarginLane.Left, zIndex: 10, range: new Range(at.fromLine, 1, at.toLine, 1) }),
		};
		editor.addGlyphMarginWidget(widget);
		return toDisposable(() => { editor.removeGlyphMarginWidget(widget); unmount(); });
	}
}
