/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from "../../base/common/codicons.js";
import { Disposable } from "../../base/common/lifecycle.js";
import { autorun, type IObservable } from "../../base/common/observable.js";
import { ThemeIcon } from "../../base/common/themables.js";
import { ContentWidgetPositionPreference, MouseTargetType, type ICodeEditor, type IContentWidget, type IContentWidgetPosition, type IEditorMouseEvent } from "../../editor/browser/editorBrowser.js";
import { EditorOption } from "../../editor/common/config/editorOptions.js";
import { CursorColumns } from "../../editor/common/core/cursorColumns.js";
import { Range } from "../../editor/common/core/range.js";
import { InjectedTextCursorStops, type IModelDeltaDecoration, type ITextModel } from "../../editor/common/model.js";
import { structuralFoldables, type StructuralFoldable, type StructuralTextDiff } from "../common/reviewStructuralDiff.js";
import type { UnchangedRegion } from "../../editor/browser/widget/diffEditor/diffEditorViewModel.js";
import type { StructuralDiffSession } from "./reviewStructuralDiffSession.js";

/** The scope under the pointer. */
interface FoldTarget {
	readonly foldable: StructuralFoldable;
	/** The pointer is on the scope's rail. */
	readonly rail: boolean;
	/** The pointer is on the scope's chevron, or on a folded scope's pill. */
	readonly control: boolean;
	readonly collapsed: boolean;
}

const CHEVRON = "review-fold-chevron";
const RAIL_CURSOR = "review-fold-rail";
/** Marks the text after a folded header, so that a click on it unfolds the scope. */
const PILL = Symbol("review-fold-pill");

/**
 * Chevrons, rails and header-line folds for one side of a structural diff
 * editor. The pointer's scope shows its chevron, rail and braces. A click on
 * the chevron or the rail sets the scope's fold state in the session.
 */
export class StructuralFoldControls extends Disposable {
	private readonly decorations = this.editor.createDecorationsCollection();
	private readonly foldables = new WeakMap<StructuralTextDiff, StructuralFoldable[]>();
	private readonly rail = new ScopeRail(this.editor);
	private hovered: FoldTarget | undefined;
	private pressed: FoldTarget | undefined;
	/** The rail anchors on the line under the pointer, which is always rendered. */
	private pointerLine = 1;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly side: "lhs" | "rhs",
		private readonly path: () => string | undefined,
		private readonly session: StructuralDiffSession,
		/** The regions the diff editor hides now. */
		private readonly regions: IObservable<readonly UnchangedRegion[]>,
	) {
		super();
		this._register({ dispose: () => { this.decorations.clear(); this.rail.hide(); } });
		this._register(editor.onMouseMove(e => {
			this.pointerLine = e.target.position?.lineNumber ?? this.pointerLine;
			this.hover(this.targetAt(e));
		}));
		this._register(editor.onMouseLeave(() => this.hover(undefined)));
		this._register(editor.onMouseDown(e => {
			const target = e.event.leftButton ? this.targetAt(e) : undefined;
			this.pressed = target?.rail || target?.control ? target : undefined;
		}));
		this._register(editor.onMouseUp(e => {
			const pressed = this.pressed;
			this.pressed = undefined;
			const target = this.targetAt(e);
			if (pressed && target?.foldable === pressed.foldable && target.rail === pressed.rail && target.control === pressed.control) {
				this.toggle(pressed);
			}
		}));
		this._register(editor.onDidChangeModel(() => { this.hovered = undefined; this.render(); }));
		// Folding changes which lines show, and so the rail's length.
		this._register(editor.onDidContentSizeChange(() => this.render()));
		// The pills follow what the editor hides, not the fold state.
		this._register(autorun(reader => {
			for (const region of regions.read(reader)) {
				region.visibleLineCountTop.read(reader);
				region.visibleLineCountBottom.read(reader);
			}
			this.render();
		}));
		this._register(session.onDidChange(change => {
			const path = this.path();
			if (path && change.files.has(path)) {
				this.hovered = undefined;
				this.render();
			}
		}));
		this.render();
	}

	private toggle(target: FoldTarget): void {
		const path = this.path();
		if (!path) {
			return;
		}
		// A rail click puts the caret in the body, and a caret in hidden lines reveals them.
		if (target.rail) {
			this.editor.setPosition({ lineNumber: target.foldable.line + 1, column: 1 });
		}
		this.session.setRegionCollapsed(path, target.foldable.foldStateId, !target.collapsed);
	}

	private hover(target: FoldTarget | undefined): void {
		const hovered = this.hovered;
		if (hovered?.foldable === target?.foldable && hovered?.rail === target?.rail && hovered?.control === target?.control) {
			return;
		}
		this.hovered = target;
		this.render();
	}

	private render(): void {
		const model = this.editor.getModel();
		const path = this.path();
		const diff = path ? this.session.getTextDiff(path) : undefined;
		const target = this.hovered;
		this.editor.getDomNode()?.classList.toggle(RAIL_CURSOR, !!target?.rail);
		if (!model || !path || !diff) {
			this.decorations.clear();
			this.rail.hide();
			return;
		}
		const decorations: IModelDeltaDecoration[] = [];
		for (const foldable of this.foldablesOf(diff)) {
			if (this.isFolded(foldable)) {
				decorations.push(...this.folded(model, foldable, target?.foldable === foldable));
			}
		}
		if (target && !target.collapsed) {
			decorations.push(...this.lit(model, target));
			if (target.foldable.rail) {
				this.rail.show(target.foldable, leadingWidth(model, target.foldable.line + 1), target.rail || target.control, this.pointerLine);
			} else {
				this.rail.hide();
			}
		} else {
			this.rail.hide();
		}
		this.decorations.set(decorations);
	}

	/** A folded scope on its header line: a chevron to unfold it, then `⋯ N lines` and the closer. */
	private folded(model: ITextModel, foldable: StructuralFoldable, targeted: boolean): IModelDeltaDecoration[] {
		const line = foldable.line + 1;
		const end = model.getLineMaxColumn(line);
		const inline = foldable.inline!;
		return [
			{
				range: new Range(line, 1, line, 1),
				options: { description: CHEVRON, glyphMarginClassName: `${CHEVRON} is-collapsed ${ThemeIcon.asClassName(Codicon.chevronRight)}${targeted ? " is-target" : ""}` },
			},
			{
				range: new Range(line, end, line, end),
				options: {
					description: "review-fold-pill",
					// Monaco drops text on an empty range without this.
					showIfCollapsed: true,
					after: { content: `⋯ ${inline.label}`, inlineClassName: `review-fold-pill${targeted ? " is-target" : ""}`, cursorStops: InjectedTextCursorStops.None, attachedData: PILL },
				},
			},
			{
				range: new Range(line, end, line, end),
				options: {
					description: "review-fold-closer",
					showIfCollapsed: true,
					after: { content: inline.closer, inlineClassName: "review-fold-closer", cursorStops: InjectedTextCursorStops.None, attachedData: PILL },
				},
			},
		];
	}

	/** An open scope the pointer is in: its chevron and braces, and when targeted, the body a click folds. */
	private lit(model: ITextModel, target: FoldTarget): IModelDeltaDecoration[] {
		const { foldable } = target;
		const line = foldable.line + 1;
		const targeted = target.rail || target.control;
		const state = targeted ? " is-target" : "";
		const result: IModelDeltaDecoration[] = [{
			range: new Range(line, 1, line, 1),
			options: { description: CHEVRON, glyphMarginClassName: `${CHEVRON} ${ThemeIcon.asClassName(Codicon.chevronDown)}${state}` },
		}];
		for (const brace of foldable.braces ? [foldable.braces.opener, foldable.braces.closer] : []) {
			result.push({
				range: new Range(brace.line, brace.column, brace.line, brace.column + 1),
				options: { description: "review-scope-brace", inlineClassName: `review-scope-brace${state}` },
			});
		}
		if (targeted && foldable.rail) {
			const lines = foldable.rail.end - foldable.rail.start;
			if (lines > 0) {
				result.push({
					range: new Range(foldable.rail.start + 1, 1, foldable.rail.end, 1),
					options: { description: "review-fold-wash", className: "review-fold-wash", isWholeLine: true },
				});
			}
			const end = model.getLineMaxColumn(line);
			result.push({
				range: new Range(line, end, line, end),
				options: {
					description: "review-fold-hint",
					showIfCollapsed: true,
					after: { content: `click · fold ${lines} line${lines === 1 ? "" : "s"}`, inlineClassName: "review-fold-hint", cursorStops: InjectedTextCursorStops.None },
				},
			});
		}
		return result;
	}

	private targetAt(e: IEditorMouseEvent): FoldTarget | undefined {
		const model = this.editor.getModel();
		const path = this.path();
		const diff = path ? this.session.getTextDiff(path) : undefined;
		const position = e.target.position;
		if (!model || !path || !diff || !position) {
			return undefined;
		}
		const line = position.lineNumber - 1;
		const foldables = this.foldablesOf(diff);
		const content = e.target.type === MouseTargetType.CONTENT_TEXT || e.target.type === MouseTargetType.CONTENT_EMPTY;
		const gutter = e.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN
			|| e.target.type === MouseTargetType.GUTTER_LINE_NUMBERS
			|| e.target.type === MouseTargetType.GUTTER_LINE_DECORATIONS;
		if (!content && !gutter) {
			return undefined;
		}
		const onChevron = e.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN && !!e.target.element?.classList.contains(CHEVRON);

		// A folded scope's header: its chevron and its pill unfold it.
		const folded = foldables.find(f => f.line === line && this.isFolded(f));
		if (folded) {
			const onPill = e.target.type === MouseTargetType.CONTENT_TEXT && e.target.detail.injectedText?.options.attachedData === PILL;
			return { foldable: folded, rail: false, control: onChevron || onPill, collapsed: true };
		}

		const open = foldables.filter(f => !this.isCollapsed(path, f));
		const railsHere = open
			.filter(f => f.rail && f.rail.start <= line && line <= f.rail.end)
			.sort((a, b) => (a.rail!.end - a.rail!.start) - (b.rail!.end - b.rail!.start));
		if (content && e.target.mouseColumn - 1 < leadingWidth(model, position.lineNumber)) {
			const column = e.target.mouseColumn - 1;
			const rail = railsHere.find(f => leadingWidth(model, f.line + 1) === column);
			if (rail) {
				return { foldable: rail, rail: true, control: false, collapsed: false };
			}
		}
		const header = open.find(f => f.chevron && f.line === line);
		if (header) {
			return { foldable: header, rail: false, control: onChevron, collapsed: false };
		}
		// Inside a body, the innermost rail's scope.
		return railsHere[0] ? { foldable: railsHere[0], rail: false, control: false, collapsed: false } : undefined;
	}

	private foldablesOf(diff: StructuralTextDiff): StructuralFoldable[] {
		let foldables = this.foldables.get(diff);
		if (!foldables) {
			foldables = structuralFoldables(diff[this.side]);
			this.foldables.set(diff, foldables);
		}
		return foldables;
	}

	private isCollapsed(path: string, foldable: StructuralFoldable): boolean {
		return this.session.isRegionCollapsed(path, foldable.foldStateId) ?? foldable.collapsedByDefault;
	}

	/** Whether the editor hides the scope's body with no band, so the header shows the fold. */
	private isFolded(foldable: StructuralFoldable): boolean {
		return !!foldable.inline && this.regions.get().some(region => {
			if (region.band || region.foldStateId !== foldable.foldStateId) { return false; }
			const hidden = this.side === "rhs" ? region.getHiddenModifiedRange(undefined) : region.getHiddenOriginalRange(undefined);
			return hidden.startLineNumber === foldable.line + 2 && !hidden.isEmpty;
		});
	}
}

/**
 * The lit rail of the pointer's scope, from below the header to the closer. It
 * is one element, so it does not break at bands or removed lines.
 */
class ScopeRail implements IContentWidget {
	readonly allowEditorOverflow = false;
	readonly suppressMouseDown = true;
	private readonly node: HTMLElement;
	private position: IContentWidgetPosition | null = null;
	private added = false;

	constructor(private readonly editor: ICodeEditor) {
		this.node = editor.getContainerDomNode().ownerDocument.createElement("div");
		this.node.className = "review-scope-rail";
	}

	getId(): string { return "review.scopeRail"; }
	getDomNode(): HTMLElement { return this.node; }
	getPosition(): IContentWidgetPosition | null { return this.position; }

	show(foldable: StructuralFoldable, indent: number, targeted: boolean, anchor: number): void {
		const rail = foldable.rail!;
		const top = this.editor.getTopForLineNumber(rail.start + 1) - this.editor.getTopForLineNumber(anchor);
		const height = this.editor.getTopForLineNumber(rail.end + 1) - this.editor.getTopForLineNumber(rail.start + 1);
		this.node.style.marginTop = `${top}px`;
		this.node.style.marginLeft = `${indent * this.editor.getOption(EditorOption.fontInfo).spaceWidth}px`;
		this.node.style.height = `${height}px`;
		this.node.classList.toggle("is-target", targeted);
		this.position = { position: { lineNumber: anchor, column: 1 }, preference: [ContentWidgetPositionPreference.EXACT] };
		if (this.added) {
			this.editor.layoutContentWidget(this);
		} else {
			this.editor.addContentWidget(this);
			this.added = true;
		}
	}

	hide(): void {
		if (this.added) {
			this.editor.removeContentWidget(this);
			this.added = false;
		}
		this.position = null;
	}
}

/** The visible width of a line's indent. A blank line has no limit, so rails continue through it. */
function leadingWidth(model: ITextModel, lineNumber: number): number {
	const column = model.getLineFirstNonWhitespaceColumn(lineNumber);
	if (column === 0) {
		return Number.POSITIVE_INFINITY;
	}
	return CursorColumns.visibleColumnFromColumn(model.getLineContent(lineNumber), column, model.getOptions().tabSize);
}
