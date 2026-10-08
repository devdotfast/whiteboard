/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from "../../base/common/codicons.js";
import { Disposable } from "../../base/common/lifecycle.js";
import { autorun, observableValue, type IObservable } from "../../base/common/observable.js";
import { ThemeIcon } from "../../base/common/themables.js";
import { MouseTargetType, type ICodeEditor, type IPartialEditorMouseEvent } from "../../editor/browser/editorBrowser.js";
import { PartFingerprint, PartFingerprints } from "../../editor/browser/view/viewPart.js";
import { EditorOption } from "../../editor/common/config/editorOptions.js";
import { CursorColumns } from "../../editor/common/core/cursorColumns.js";
import { Range } from "../../editor/common/core/range.js";
import { InjectedTextCursorStops, type IModelDeltaDecoration, type ITextModel } from "../../editor/common/model.js";
import { bandDetail, structuralFoldables, type StructuralFoldable, type StructuralTextDiff } from "../common/reviewStructuralDiff.js";
import type { UnchangedRegion } from "../../editor/browser/widget/diffEditor/diffEditorViewModel.js";
import type { StructuralDiffSession } from "./reviewStructuralDiffSession.js";
import type { ScopeViewedControl } from "./reviewStructuralViewedControl.js";
import type { StructuralViewedState } from "./reviewStructuralViewed.js";

/** The scope under the pointer. */
export interface FoldTarget {
	readonly foldable: StructuralFoldable;
	/** The pointer is on the scope's rail. */
	readonly rail: boolean;
	/** The pointer is on the scope's chevron, or on a folded scope's pill. */
	readonly control: boolean;
	readonly collapsed: boolean;
}

/** Transient presentation state shared only by the two panes of one file. */
export class StructuralFoldHover {
	readonly state = observableValue<{
		readonly owner: StructuralFoldControls;
		readonly path: string | undefined;
		readonly target: FoldTarget | undefined;
		readonly column: boolean;
	} | undefined>("structuralFoldHover", undefined);
}

type ViewedCandidate = { readonly active: boolean; readonly target: FoldTarget; readonly progress: ReturnType<StructuralViewedState['get']> };

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
	private readonly sourceLineCounts = new WeakMap<StructuralTextDiff, number>();
	private readonly rails = new ScopeRails(this.editor);
	private hovered: FoldTarget | undefined;
	private view: { model: ITextModel; target: FoldTarget | undefined; visibleScopes: readonly StructuralFoldable[]; controls: readonly ViewedCandidate[] } | undefined;
	private overChevronColumn = false;
	private pressed: { target: FoldTarget; x: number; y: number } | undefined;
	private readonly viewedControls = new Map<number, ScopeViewedControl>();

	constructor(
		private readonly editor: ICodeEditor,
		private readonly side: "lhs" | "rhs",
		private readonly path: () => string | undefined,
		private readonly session: StructuralDiffSession,
		/** The regions the diff editor hides now. */
		private readonly regions: IObservable<readonly UnchangedRegion[]>,
		private readonly sharedHover: StructuralFoldHover,
		private readonly viewed?: StructuralViewedState,
	) {
		super();
		this._register({ dispose: () => {
			for (const control of this.viewedControls.values()) control.dispose();
			this.viewedControls.clear();
		} });
		if (viewed) this._register(viewed.onDidChange(() => this.render()));
		this._register({ dispose: () => {
			if (this.sharedHover.state.get()?.owner === this) { this.sharedHover.state.set(undefined, undefined); }
			this.decorations.clear(); this.rails.hide();
		} });
		this._register(editor.onMouseMove(e => {
			this.hover(this.targetAt(e), this.inChevronColumn(e));
		}));
		// Monaco can report a mouse leave while crossing an overlay layer on
		// the way from a scope header to its viewed control. Keep the scope if
		// the pointer is still over this editor's code area.
		this._register(editor.onMouseLeave(e => this.hover(this.targetAt({ event: e.event, target: null }))));
		this._register(editor.onMouseDown(e => {
			const target = e.event.leftButton ? this.targetAt(e) : undefined;
			this.pressed = target?.rail || target?.control ? {
				target, x: e.event.browserEvent.clientX, y: e.event.browserEvent.clientY,
			} : undefined;
			if (this.pressed) { e.event.preventDefault(); }
		}));
		this._register(editor.onMouseUp(e => {
			const pressed = this.pressed;
			this.pressed = undefined;
			if (!pressed) return;
			const target = this.targetAt(e);
			const dx = e.event.browserEvent.clientX - pressed.x;
			const dy = e.event.browserEvent.clientY - pressed.y;
			if (dx * dx + dy * dy <= 64 && target?.foldable.foldStateId === pressed.target.foldable.foldStateId) {
				this.toggle(pressed.target);
			}
		}));
		this._register(editor.onDidChangeModel(() => { this.hovered = undefined; this.render(); }));
		// These move lines without changing scope state.
		this._register(editor.onDidContentSizeChange(e => { if (e.contentHeightChanged) this.layoutViewport(); }));
		this._register(editor.onDidChangeViewZones(() => this.layoutViewport()));
		this._register(editor.onDidScrollChange(() => { this.rails.offset(); this.placeControls(); }));
		this._register(editor.onDidLayoutChange(() => this.placeControls()));
		this._register(editor.onDidChangeConfiguration(() => this.render()));
		// The pills follow what the editor hides, not the fold state.
		this._register(autorun(reader => {
			this.sharedHover.state.read(reader);
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

	private inChevronColumn(e: IPartialEditorMouseEvent): boolean {
		const node = this.editor.getDomNode();
		if (!node) { return false; }
		const bounds = node.getBoundingClientRect();
		const x = (e.event.browserEvent.clientX - bounds.left) * node.offsetWidth / bounds.width;
		const layout = this.editor.getLayoutInfo();
		return x >= layout.decorationsLeft && x < layout.contentLeft;
	}

	private hover(target: FoldTarget | undefined, overChevronColumn = false): void {
		const hovered = this.hovered;
		if (this.overChevronColumn === overChevronColumn && hovered?.foldable === target?.foldable && hovered?.rail === target?.rail && hovered?.control === target?.control) {
			return;
		}
		this.hovered = target;
		this.overChevronColumn = overChevronColumn;
		if (target || overChevronColumn) {
			this.sharedHover.state.set({ owner: this, path: this.path(), target, column: overChevronColumn }, undefined);
		} else if (this.sharedHover.state.get()?.owner === this) {
			this.sharedHover.state.set(undefined, undefined);
		}
	}

	private render(): void {
		const model = this.editor.getModel();
		const path = this.path();
		const diff = path ? this.session.getTextDiff(path) : undefined;
		const hover = this.sharedHover.state.get();
		const shared = hover?.path === path ? hover : undefined;
		const target = shared?.target;
		this.editor.getDomNode()?.classList.toggle(RAIL_CURSOR, !!target?.rail);
		// A diff editor changes its model before its two code editors have both
		// attached the new snapshots. Do not paint old scope line numbers on the
		// temporary model in between.
		let sourceLineCount = diff ? this.sourceLineCounts.get(diff) : undefined;
		if (diff && sourceLineCount === undefined) {
			sourceLineCount = (diff[this.side]?.text.match(/\n/g)?.length ?? 0) + 1;
			this.sourceLineCounts.set(diff, sourceLineCount);
		}
		if (!model || !path || !diff || model.getLineCount() !== sourceLineCount) {
			this.view = undefined;
			this.decorations.clear();
			this.rails.hide();
			for (const control of this.viewedControls.values()) control.hide();
			return;
		}
		const decorations: IModelDeltaDecoration[] = [];
		const folded = this.foldedHeaders();
		for (const range of this.viewed?.getViewedRanges(path) ?? []) {
			if (range.side !== (this.side === 'rhs' ? 'head' : 'base')) continue;
			if (range.fromLine < 1 || range.toLine > model.getLineCount()) continue;
			decorations.push({
				range: new Range(range.fromLine, 1, range.toLine, model.getLineMaxColumn(range.toLine)),
				options: { description: 'review-scope-viewed', isWholeLine: true, inlineClassName: 'review-scope-viewed-ink', className: 'review-scope-viewed-tint', zIndex: 5 },
			});
		}
		for (const foldable of this.foldablesOf(diff)) {
			// A function and its doc comment can share one fold state. Every
			// member participates in hover, rather than only the first match.
			const active = target?.foldable.foldStateId === foldable.foldStateId;
			if (this.isFolded(foldable, folded)) {
				decorations.push(...this.folded(model, foldable, active));
			} else if (active) {
				decorations.push(...this.lit(model, { ...target!, foldable, collapsed: this.isSummaryFolded(foldable) }));
			} else if (shared?.column && foldable.chevron && (!this.isCollapsed(path, foldable) || this.isSummaryFolded(foldable))) {
				decorations.push(this.chevron(foldable, this.isSummaryFolded(foldable), false));
			}
		}
		const hidden = this.regions.get().map(region => this.side === "rhs" ? region.getHiddenModifiedRange(undefined) : region.getHiddenOriginalRange(undefined));
		const visibleScopes = this.foldablesOf(diff).filter(foldable => foldable.rail
			&& !this.isFolded(foldable, folded)
			&& !hidden.some(range => range.contains(foldable.line + 1)));
		this.decorations.set(decorations);
		// Completed scopes remain discoverable after the pointer leaves. Only
		// visible headers get widgets, so folded descendants never float over code.
		const controls: ViewedCandidate[] = [];
		const completed = this.foldablesOf(diff).filter(scope => scope.rail && this.viewed?.get(path, scope.foldStateId).state === 'viewed');
		for (const scope of this.foldablesOf(diff)) {
			if (!scope.rail || hidden.some(range => range.contains(scope.line + 1))) continue;
			const active = scope.foldStateId === target?.foldable.foldStateId;
			const progress = this.viewed?.get(path, scope.foldStateId);
			if (!progress || progress.total.additions + progress.total.deletions === 0) continue;
			if (!active && progress.state !== 'viewed') continue;
			// A viewed function already accounts for its viewed return/body folds.
			// Keep their actions on hover, but don't stack persistent completion badges.
			if (!active && completed.some(outer => outer.line < scope.line && outer.rail!.end >= scope.rail!.end)) continue;
			controls.push({ active, progress, target: { foldable: scope, collapsed: this.isFolded(scope, folded), rail: false, control: false } });
		}
		this.view = { model, target, visibleScopes, controls };
		this.layoutViewport();
	}

	private layoutViewport(): void {
		const view = this.view;
		if (!view) return;
		this.rails.show(view.model, view.visibleScopes, view.target);
		this.placeControls();
	}

	private placeControls(): void {
		const view = this.view;
		if (!view) return;
		const height = this.editor.getLayoutInfo().height;
		const wanted = new Map<number, ViewedCandidate>();
		for (const entry of view.controls) {
			const line = entry.target.foldable.line;
			const top = this.editor.getTopForLineNumber(line + 1) - this.editor.getScrollTop();
			if (top < 0 || top >= height) continue;
			if (entry.active || !wanted.has(line)) wanted.set(line, entry);
		}
		for (const [line, control] of this.viewedControls) {
			if (!wanted.has(line)) { control.dispose(); this.viewedControls.delete(line); }
		}
		for (const [line, entry] of wanted) {
			let control = this.viewedControls.get(line);
			if (!control) {
				control = this.viewed!.createControl(this.editor, target => {
					const path = this.path();
					if (!path) return;
					// Keep the caret out of the body that the viewed mark will fold.
					this.editor.setPosition({ lineNumber: target.foldable.line + 1, column: 1 });
					void this.viewed!.toggle(path, target.foldable.foldStateId);
				});
				this.viewedControls.set(line, control);
			}
			control.show(entry.target, entry.progress);
		}
	}

	/** A folded scope on its header line: a chevron to unfold it, then `⋯ N lines` and the closer. */
	private folded(model: ITextModel, foldable: StructuralFoldable, targeted: boolean): IModelDeltaDecoration[] {
		const line = foldable.line + 1;
		const end = model.getLineMaxColumn(line);
		const inline = foldable.inline!;
		const viewed = this.viewed?.get(this.path()!, foldable.foldStateId).state === 'viewed';
		return [
			this.chevron(foldable, true, targeted),
			{
				range: new Range(line, end, line, end),
				options: {
					description: "review-fold-pill",
					// Monaco drops text on an empty range without this.
					showIfCollapsed: true,
					after: { content: `${viewed ? '✓' : '⋯'} ${inline.label}`, inlineClassName: `review-fold-pill${targeted ? " is-target" : ""}${viewed ? ' is-viewed' : ''}`, cursorStops: InjectedTextCursorStops.None, attachedData: PILL },
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

	/** An open scope the pointer is in: its chevron and braces, and when targeted, a fold hint. */
	private lit(model: ITextModel, target: FoldTarget): IModelDeltaDecoration[] {
		const { foldable } = target;
		const line = foldable.line + 1;
		const targeted = target.rail || target.control;
		const state = targeted ? " is-target" : "";
		const result: IModelDeltaDecoration[] = foldable.chevron ? [this.chevron(foldable, target.collapsed, targeted)] : [];
		for (const brace of foldable.braces ? [foldable.braces.opener, foldable.braces.closer] : []) {
			result.push({
				range: new Range(brace.line, brace.column, brace.line, brace.column + 1),
				options: { description: "review-scope-brace", inlineClassName: `review-scope-brace${state}` },
			});
		}
		if (targeted && foldable.rail) {
			const lines = foldable.rail.end - foldable.rail.start;
			const end = model.getLineMaxColumn(line);
			result.push({
				range: new Range(line, end, line, end),
				options: {
					description: "review-fold-hint",
					showIfCollapsed: true,
					after: { content: `click · ${target.collapsed ? "expand" : "fold"} ${lines} line${lines === 1 ? "" : "s"}`, inlineClassName: "review-fold-hint", cursorStops: InjectedTextCursorStops.None },
				},
			});
		}
		return result;
	}

	private chevron(foldable: StructuralFoldable, collapsed: boolean, targeted: boolean): IModelDeltaDecoration {
		const line = foldable.line + 1;
		return {
			range: new Range(line, 1, line, 1),
			options: {
				description: CHEVRON,
				linesDecorationsClassName: `${CHEVRON} ${ThemeIcon.asClassName(collapsed ? Codicon.chevronRight : Codicon.chevronDown)}${collapsed ? " is-collapsed" : ""}${targeted ? " is-target" : ""}`,
			},
		};
	}

	private targetAt(e: IPartialEditorMouseEvent): FoldTarget | undefined {
		for (const control of this.viewedControls.values()) {
			const viewed = control.targetOf(e.event.browserEvent.target as HTMLElement | null);
			if (viewed) return { ...viewed, rail: false, control: false };
		}
		const model = this.editor.getModel();
		const path = this.path();
		const diff = path ? this.session.getTextDiff(path) : undefined;
		const summary = (e.event.browserEvent.target as HTMLElement | null)?.closest?.("[data-summary-fold-state-id]");
		if (summary && diff) {
			const foldable = this.foldablesOf(diff).find(f => f.rail && f.foldStateId === Number(summary.getAttribute("data-summary-fold-state-id")));
			if (foldable) return { foldable, rail: true, control: false, collapsed: true };
		}
		// Overlay layers can turn the blank space between code and the viewed
		// control into UNKNOWN/OVERLAY_WIDGET with no position. Resolve the
		// point without its DOM target so the same header or rail remains armed.
		const direct = e.target;
		const usable = direct?.type === MouseTargetType.CONTENT_TEXT || direct?.type === MouseTargetType.CONTENT_EMPTY
			|| direct?.type === MouseTargetType.GUTTER_GLYPH_MARGIN || direct?.type === MouseTargetType.GUTTER_LINE_NUMBERS
			|| direct?.type === MouseTargetType.GUTTER_LINE_DECORATIONS;
		let hit = usable ? direct : this.editor.getTargetAtClientPoint(e.event.browserEvent.clientX, e.event.browserEvent.clientY);
		if (!usable && (!hit || hit.type === MouseTargetType.OVERLAY_WIDGET || hit.type === MouseTargetType.UNKNOWN)) {
			const node = this.editor.getDomNode();
			const bounds = node?.getBoundingClientRect();
			const { clientX, clientY } = e.event.browserEvent;
			if (node && bounds && clientX >= bounds.left && clientX < bounds.right && clientY >= bounds.top && clientY < bounds.bottom) {
				// Re-hit the same row in the text column: a viewed overlay can
				// otherwise occlude Monaco's target for the space leading to it.
				const x = bounds.left + (this.editor.getLayoutInfo().contentLeft + 16) * bounds.width / node.offsetWidth;
				hit = this.editor.getTargetAtClientPoint(x, clientY);
			}
		}
		const position = hit?.position;
		const rail = this.rails.targetOf(e.event.browserEvent.target as HTMLElement | null);
		if (rail) {
			return { foldable: rail, rail: true, control: false, collapsed: this.isSummaryFolded(rail) };
		}
		if (!model || !path || !diff || !hit || !position) {
			return undefined;
		}
		const line = position.lineNumber - 1;
		const foldables = this.foldablesOf(diff);
		const content = hit?.type === MouseTargetType.CONTENT_TEXT || hit?.type === MouseTargetType.CONTENT_EMPTY;
		const gutter = hit?.type === MouseTargetType.GUTTER_GLYPH_MARGIN
			|| hit?.type === MouseTargetType.GUTTER_LINE_NUMBERS
			|| hit?.type === MouseTargetType.GUTTER_LINE_DECORATIONS;
		if (!content && !gutter) {
			return undefined;
		}
		const onChevron = this.inChevronColumn(e);

		// A folded scope's header: its chevron and its pill unfold it.
		const foldedHeaders = this.foldedHeaders();
		const folded = foldables.find(f => f.line === line && (this.isFolded(f, foldedHeaders) || this.isSummaryFolded(f)));
		if (folded) {
			const onPill = e.target?.type === MouseTargetType.CONTENT_TEXT && e.target.detail.injectedText?.options.attachedData === PILL;
			return { foldable: folded, rail: false, control: onChevron || onPill, collapsed: true };
		}

		const open = foldables.filter(f => !this.isCollapsed(path, f));
		const railsHere = open
			.filter(f => f.rail && f.rail.start <= line && line <= f.rail.end)
			.sort((a, b) => (a.rail!.end - a.rail!.start) - (b.rail!.end - b.rail!.start));
		if (content && hit.mouseColumn - 1 < leadingWidth(model, position.lineNumber)) {
			const column = hit.mouseColumn - 1;
			const rail = railsHere.find(f => leadingWidth(model, f.line + 1) === column);
			if (rail) {
				return { foldable: rail, rail: true, control: false, collapsed: this.isSummaryFolded(rail) };
			}
		}
		const header = open.find(f => f.chevron && f.line === line);
		if (header) {
			return { foldable: header, rail: false, control: onChevron, collapsed: false };
		}
		// A blank spot in the chevron column reveals controls without lighting a scope.
		if (this.inChevronColumn(e)) { return undefined; }
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

	private isSummaryFolded(foldable: StructuralFoldable): boolean {
		return !!foldable.rail && this.regions.get().some(region => {
			if (region.foldStateId !== foldable.foldStateId || !bandDetail(region.readLabel(undefined) ?? "")) return false;
			return !(this.side === "rhs" ? region.getHiddenModifiedRange(undefined) : region.getHiddenOriginalRange(undefined)).isEmpty;
		});
	}

	/** Whether the editor hides the scope's body with no band, so the header shows the fold. */
	private isFolded(foldable: StructuralFoldable, folded: ReadonlySet<string>): boolean {
		return !!foldable.inline && folded.has(`${foldable.foldStateId}:${foldable.line}`);
	}

	private foldedHeaders(): Set<string> {
		const result = new Set<string>();
		for (const region of this.regions.get()) {
			if (region.band) { continue; }
			const hidden = this.side === "rhs" ? region.getHiddenModifiedRange(undefined) : region.getHiddenOriginalRange(undefined);
			if (!hidden.isEmpty) { result.add(`${region.foldStateId}:${hidden.startLineNumber - 2}`); }
		}
		return result;
	}
}

/** Scope rails scroll with the code, including the gaps occupied by view zones. */
class ScopeRails {
	private readonly node: HTMLElement;
	private readonly targets = new WeakMap<Element, StructuralFoldable>();
	private readonly segments = new Map<StructuralFoldable, HTMLElement>();
	private delta = 0;

	constructor(private readonly editor: ICodeEditor) {
		this.node = editor.getContainerDomNode().ownerDocument.createElement("div");
		this.node.className = "review-scope-rails";
		// A press on a rail starts no selection.
		PartFingerprints.write(this.node, PartFingerprint.ContentWidgets);
	}

	targetOf(element: HTMLElement | null): StructuralFoldable | undefined {
		const rail = element?.closest?.(".review-scope-rail");
		return rail ? this.targets.get(rail) : undefined;
	}

	show(model: ITextModel, foldables: readonly StructuralFoldable[], target: FoldTarget | undefined): void {
		// A model change builds a new view.
		const content = this.editor.getDomNode()?.querySelector(":scope > .overflow-guard > .monaco-scrollable-element > .lines-content");
		if (!content) { this.hide(); return; }
		if (this.node.parentElement !== content) { content.append(this.node); }
		const spaceWidth = this.editor.getOption(EditorOption.fontInfo).spaceWidth;
		const segments: HTMLElement[] = [];
		for (const foldable of foldables) {
			// Start after the header, not at the first body line: it may be hidden
			// behind a band, which Monaco maps back onto the header itself.
			const top = this.editor.getBottomForLineNumber(foldable.line + 1);
			const bottom = this.editor.getTopForLineNumber(foldable.rail!.end + 1);
			const left = Math.round(leadingWidth(model, foldable.line + 1) * spaceWidth);
			if (bottom <= top || !Number.isFinite(left)) { continue; }
			let segment = this.segments.get(foldable);
			if (!segment) {
				segment = this.node.ownerDocument.createElement("div");
				this.segments.set(foldable, segment);
			}
			const active = target?.foldable.foldStateId === foldable.foldStateId;
			segment.className = `review-scope-rail${active ? " is-active" : ""}${active && (target.rail || target.control) ? " is-target" : ""}`;
			this.targets.set(segment, foldable);
			segment.style.top = `${top}px`;
			segment.style.left = `${left}px`;
			segment.style.height = `${bottom - top}px`;
			segments.push(segment);
		}
		for (const [foldable, segment] of this.segments) {
			if (!segments.includes(segment)) { this.segments.delete(foldable); }
		}
		// Keep the hovered element attached while its paint changes.
		if (segments.length !== this.node.children.length || segments.some((segment, i) => this.node.children[i] !== segment)) {
			this.node.replaceChildren(...segments);
		}
		this.offset();
	}

	/** Monaco shifts the code back past 500,000 pixels. */
	offset(): void {
		const delta = this.editor.getScrollTop() < 500_000 ? 0 : this.editor._getViewModel()?.viewLayout.getLinesViewportData().bigNumbersDelta ?? 0;
		if (delta === this.delta) { return; }
		this.delta = delta;
		this.node.style.transform = delta ? `translateY(${-delta}px)` : "";
	}

	hide(): void {
		this.node.remove();
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
