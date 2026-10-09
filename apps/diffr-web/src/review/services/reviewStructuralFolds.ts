/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from "vs/base/common/codicons.js";
import { Disposable } from "vs/base/common/lifecycle.js";
import {
  autorun,
  observableValue,
  type IObservable,
} from "vs/base/common/observable.js";
import { ThemeIcon } from "vs/base/common/themables.js";
import {
  MouseTargetType,
  type ICodeEditor,
  type IOverlayWidget,
  type IOverlayWidgetPosition,
  type IEditorMouseEvent,
} from "vs/editor/browser/editorBrowser.js";
import type { UnchangedRegion } from "vs/editor/browser/widget/diffEditor/diffEditorViewModel.js";
import { EditorOption } from "vs/editor/common/config/editorOptions.js";
import { CursorColumns } from "vs/editor/common/core/cursorColumns.js";
import { Range } from "vs/editor/common/core/range.js";
import {
  InjectedTextCursorStops,
  type IModelDeltaDecoration,
  type ITextModel,
} from "vs/editor/common/model.js";

import { nestedIds } from "../../folds.js";
import {
  horizontalTouchScroll,
  mobileViewport,
} from "../../nativeDiffScroll.js";
import {
  bandDetail,
  structuralFoldables,
  type StructuralFoldable,
  type StructuralTextDiff,
} from "../common/reviewStructuralDiff.js";
import type { StructuralDiffSession } from "./reviewStructuralDiffSession.js";
import type { StructuralViewedState } from "./reviewStructuralViewed.js";
import type { ScopeViewedControl } from "./reviewStructuralViewedControl.js";

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
  readonly state = observableValue<
    | {
        readonly owner: StructuralFoldControls;
        readonly path: string | undefined;
        readonly target: FoldTarget | undefined;
        readonly column: boolean;
      }
    | undefined
  >("structuralFoldHover", undefined);
}

const CHEVRON = "review-fold-chevron";
const RAIL_CURSOR = "review-fold-rail";
/** Marks the text after a folded header, so that a click on it unfolds the scope. */
const PILL = Symbol("review-fold-pill");

const controls = new WeakMap<ICodeEditor, StructuralFoldControls>();

/** Runs a fold command (see `StructuralFoldControls.command`) in a structural diff editor. */
export function structuralFoldCommand(
  editor: ICodeEditor,
  command: string,
): void {
  controls.get(editor)?.command(command);
}

/**
 * Chevrons, rails and header-line folds for one side of a structural diff
 * editor. The pointer's scope shows its chevron, rail and braces. A click on
 * the chevron or the rail sets the scope's fold state in the session.
 */
export class StructuralFoldControls extends Disposable {
  private readonly decorations = this.editor.createDecorationsCollection();
  private readonly foldables = new WeakMap<
    StructuralTextDiff,
    StructuralFoldable[]
  >();
  private readonly rails = new ScopeRails(this.editor);
  private readonly touchFolds = new TouchFoldButtons(
    this.editor,
    (foldable) => {
      this.toggle(
        {
          foldable,
          collapsed: this.isFolded(foldable) || this.isSummaryFolded(foldable),
          rail: false,
          control: true,
        },
        false,
      );
    },
  );
  private hovered: FoldTarget | undefined;
  private overChevronColumn = false;
  private pressed: FoldTarget | undefined;
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
    controls.set(editor, this);
    this.installPinchFolding();
    this._register(horizontalTouchScroll(this.editor));
    this._register({ dispose: () => controls.delete(editor) });
    this._register({
      dispose: () => {
        for (const control of this.viewedControls.values()) control.dispose();
        this.viewedControls.clear();
      },
    });
    if (viewed) this._register(viewed.onDidChange(() => this.render()));
    this._register({
      dispose: () => {
        if (this.sharedHover.state.get()?.owner === this) {
          this.sharedHover.state.set(undefined, undefined);
        }
        this.decorations.clear();
        this.rails.dispose();
        this.touchFolds.dispose();
      },
    });
    this._register(
      editor.onMouseMove((e) => {
        this.hover(this.targetAt(e), this.inChevronColumn(e));
      }),
    );
    this._register(editor.onMouseLeave(() => this.hover(undefined)));
    this._register(
      editor.onMouseDown((e) => {
        const target = e.event.leftButton ? this.targetAt(e) : undefined;
        this.pressed = target?.rail || target?.control ? target : undefined;
        if (this.pressed) {
          e.event.preventDefault();
        }
      }),
    );
    this._register(
      editor.onMouseUp((e) => {
        const pressed = this.pressed;
        this.pressed = undefined;
        const target = this.targetAt(e);
        if (
          pressed &&
          target?.foldable === pressed.foldable &&
          target.rail === pressed.rail &&
          target.control === pressed.control
        ) {
          this.toggle(pressed, e.event.altKey);
        }
      }),
    );
    this._register(
      editor.onDidChangeModel(() => {
        this.hovered = undefined;
        this.render();
      }),
    );
    // Folding changes which lines show, and so the rail's length.
    this._register(editor.onDidContentSizeChange(() => this.render()));
    this._register(editor.onDidScrollChange(() => this.render()));
    this._register(editor.onDidLayoutChange(() => this.render()));
    this._register(editor.onDidChangeViewZones(() => this.render()));
    this._register(editor.onDidChangeConfiguration(() => this.render()));
    // The pills follow what the editor hides, not the fold state.
    this._register(
      autorun((reader) => {
        this.sharedHover.state.read(reader);
        for (const region of regions.read(reader)) {
          region.visibleLineCountTop.read(reader);
          region.visibleLineCountBottom.read(reader);
        }
        this.render();
      }),
    );
    this._register(
      session.onDidChange((change) => {
        const path = this.path();
        if (path && change.files.has(path)) {
          this.hovered = undefined;
          this.render();
        }
      }),
    );
    this.render();
  }

  /**
   * The diffr TUI's fold commands, at the caret where the TUI takes its top row. `a` toggles, `o`
   * opens and `c` closes the scope whose chevron is on the caret's line, else the innermost open
   * scope around it; capitals take the folds inside too. `j` and `k` go to the next or previous
   * chevron.
   */
  command(command: string): void {
    const path = this.path();
    const diff = path ? this.session.getTextDiff(path) : undefined;
    const position = this.editor.getPosition();
    if (!path || !diff || !position) {
      return;
    }
    const line = position.lineNumber - 1;
    const foldables = this.foldablesOf(diff).filter((f) => f.chevron);
    if (command === "j" || command === "k") {
      const lines = foldables.map((f) => f.line).sort((a, b) => a - b);
      const next =
        command === "j"
          ? lines.find((l) => l > line)
          : lines.findLast((l) => l < line);
      if (next !== undefined) {
        this.editor.setPosition({ lineNumber: next + 1, column: 1 });
        this.editor.revealLineInCenterIfOutsideViewport(next + 1);
      }
      return;
    }
    const foldable =
      foldables.find((f) => f.line === line) ??
      foldables
        .filter(
          (f) =>
            f.rail &&
            !this.isCollapsed(path, f) &&
            f.rail.start <= line &&
            line <= f.rail.end,
        )
        .sort(
          (a, b) => a.rail!.end - a.rail!.start - (b.rail!.end - b.rail!.start),
        )[0];
    const letter = command.toLowerCase();
    if (!foldable || !"aoc".includes(letter)) {
      return;
    }
    const collapse =
      letter === "a" ? !this.isCollapsed(path, foldable) : letter === "c";
    // A caret in hidden lines reveals them, so it waits on the header.
    if (collapse) {
      this.editor.setPosition({ lineNumber: foldable.line + 1, column: 1 });
    }
    this.setCollapsed(path, diff, foldable, collapse, command !== letter);
  }

  private toggle(target: FoldTarget, recursive: boolean): void {
    const path = this.path();
    const diff = path ? this.session.getTextDiff(path) : undefined;
    if (!path || !diff) {
      return;
    }
    // A rail click puts the caret in the body, and a caret in hidden lines reveals them.
    if (target.rail) {
      this.editor.setPosition({
        lineNumber: target.foldable.line + 1,
        column: 1,
      });
    }
    this.setCollapsed(
      path,
      diff,
      target.foldable,
      !target.collapsed,
      recursive,
    );
  }

  private installPinchFolding(): void {
    const node = this.editor.getContainerDomNode();
    let pinch:
      | { distance: number; line: number; y: number; done: boolean }
      | undefined;
    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );
    const start = (event: TouchEvent) => {
      if (!mobileViewport.matches || event.touches.length !== 2) {
        pinch = undefined;
        return;
      }
      event.preventDefault();
      const x = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const y = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      const position = this.editor.getTargetAtClientPoint(x, y)?.position;
      pinch = {
        distance: distance(event.touches),
        line: position ? position.lineNumber - 1 : -1,
        y,
        done: false,
      };
    };
    const move = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      if (pinch.done) return;
      const delta = distance(event.touches) - pinch.distance;
      if (Math.abs(delta) < Math.max(24, pinch.distance * 0.18)) return;
      pinch.done = true;
      const path = this.path();
      const diff = path ? this.session.getTextDiff(path) : undefined;
      if (!path || !diff) return;
      const collapse = delta < 0;
      const line = pinch.line;
      const localY = pinch.y - node.getBoundingClientRect().top;
      const candidates = this.foldablesOf(diff).filter(
        (f) => f.chevron && this.isCollapsed(path, f) !== collapse,
      );
      const containing = candidates.filter(
        (f) =>
          f.line === line ||
          (collapse && f.rail && f.rail.start <= line && line <= f.rail.end),
      );
      const foldable =
        containing.sort(
          (a, b) =>
            (a.rail ? a.rail.end - a.rail.start : 0) -
            (b.rail ? b.rail.end - b.rail.start : 0),
        )[0] ??
        candidates
          .map((f) => ({
            f,
            distance: Math.abs(
              this.editor.getTopForLineNumber(f.line + 1) -
                this.editor.getScrollTop() +
                this.editor.getOption(EditorOption.lineHeight) / 2 -
                localY,
            ),
          }))
          .filter((f) => f.distance <= 44)
          .sort((a, b) => a.distance - b.distance)[0]?.f;
      if (foldable) this.setCollapsed(path, diff, foldable, collapse, false);
    };
    const end = () => {
      pinch = undefined;
    };
    const gesture = (event: Event) => {
      if (mobileViewport.matches) event.preventDefault();
    };
    node.addEventListener("touchstart", start, { passive: false });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", end);
    node.addEventListener("gesturestart", gesture);
    node.addEventListener("gesturechange", gesture);
    this._register({
      dispose: () => {
        node.removeEventListener("touchstart", start);
        node.removeEventListener("touchmove", move);
        node.removeEventListener("touchend", end);
        node.removeEventListener("touchcancel", end);
        node.removeEventListener("gesturestart", gesture);
        node.removeEventListener("gesturechange", gesture);
      },
    });
  }

  /** Recursively, every fold inside takes the same state. */
  private setCollapsed(
    path: string,
    diff: StructuralTextDiff,
    foldable: StructuralFoldable,
    collapsed: boolean,
    recursive: boolean,
  ): void {
    const id = foldable.foldStateId;
    for (const each of recursive ? [id, ...nestedIds(diff, id)] : [id]) {
      this.session.setRegionCollapsed(path, each, collapsed);
    }
  }

  private inChevronColumn(e: IEditorMouseEvent): boolean {
    const node = this.editor.getDomNode();
    if (!node) {
      return false;
    }
    const bounds = node.getBoundingClientRect();
    const x =
      ((e.event.browserEvent.clientX - bounds.left) * node.offsetWidth) /
      bounds.width;
    const layout = this.editor.getLayoutInfo();
    return x >= layout.decorationsLeft && x < layout.contentLeft;
  }

  private hover(
    target: FoldTarget | undefined,
    overChevronColumn = false,
  ): void {
    const hovered = this.hovered;
    if (
      this.overChevronColumn === overChevronColumn &&
      hovered?.foldable === target?.foldable &&
      hovered?.rail === target?.rail &&
      hovered?.control === target?.control
    ) {
      return;
    }
    this.hovered = target;
    this.overChevronColumn = overChevronColumn;
    if (target || overChevronColumn) {
      this.sharedHover.state.set(
        { owner: this, path: this.path(), target, column: overChevronColumn },
        undefined,
      );
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
    if (!model || !path || !diff) {
      this.decorations.clear();
      this.rails.hide();
      this.touchFolds.hide();
      for (const control of this.viewedControls.values()) control.hide();
      return;
    }
    const decorations: IModelDeltaDecoration[] = [];
    for (const range of this.viewed?.getViewedRanges(path) ?? []) {
      if (range.side !== (this.side === "rhs" ? "head" : "base")) continue;
      decorations.push({
        range: new Range(
          range.fromLine,
          1,
          range.toLine,
          model.getLineMaxColumn(range.toLine),
        ),
        options: {
          description: "review-scope-viewed",
          isWholeLine: true,
          inlineClassName: "review-scope-viewed-ink",
          className: "review-scope-viewed-tint",
          zIndex: 5,
        },
      });
    }
    for (const foldable of this.foldablesOf(diff)) {
      // A function and its doc comment can share one fold state. Every
      // member participates in hover, rather than only the first match.
      const active = target?.foldable.foldStateId === foldable.foldStateId;
      if (this.isFolded(foldable)) {
        decorations.push(...this.folded(model, foldable, active));
      } else if (active) {
        decorations.push(
          ...this.lit(model, {
            ...target!,
            foldable,
            collapsed: this.isSummaryFolded(foldable),
          }),
        );
      } else if (
        shared?.column &&
        foldable.chevron &&
        (!this.isCollapsed(path, foldable) || this.isSummaryFolded(foldable))
      ) {
        decorations.push(
          this.chevron(foldable, this.isSummaryFolded(foldable), false),
        );
      }
    }
    const hidden = this.regions
      .get()
      .map((region) =>
        this.side === "rhs"
          ? region.getHiddenModifiedRange(undefined)
          : region.getHiddenOriginalRange(undefined),
      );
    this.touchFolds.show(
      this.foldablesOf(diff).filter(
        (foldable) =>
          foldable.chevron &&
          !hidden.some((range) => range.contains(foldable.line + 1)),
      ),
      (foldable) => this.isFolded(foldable) || this.isSummaryFolded(foldable),
    );
    const visibleScopes = this.foldablesOf(diff).filter(
      (foldable) =>
        foldable.rail &&
        !this.isFolded(foldable) &&
        !hidden.some((range) => range.contains(foldable.line + 1)),
    );
    this.rails.show(model, visibleScopes, target);
    this.decorations.set(decorations);
    // Completed scopes remain discoverable after the pointer leaves. Only
    // visible headers get widgets, so folded descendants never float over code.
    const wanted = new Map<
      number,
      { target: FoldTarget; progress: ReturnType<StructuralViewedState["get"]> }
    >();
    const completed = this.foldablesOf(diff).filter(
      (scope) =>
        scope.rail &&
        this.viewed?.get(path, scope.foldStateId).state === "viewed",
    );
    for (const scope of this.foldablesOf(diff)) {
      if (!scope.rail || hidden.some((range) => range.contains(scope.line + 1)))
        continue;
      const active = scope.foldStateId === target?.foldable.foldStateId;
      const progress = this.viewed?.get(path, scope.foldStateId);
      if (
        !progress ||
        progress.total.additions + progress.total.deletions === 0
      )
        continue;
      if (!active && progress.state !== "viewed") continue;
      // A viewed function already accounts for its viewed return/body folds.
      // Keep their actions on hover, but don't stack persistent completion badges.
      if (
        !active &&
        completed.some(
          (outer) =>
            outer.line < scope.line && outer.rail!.end >= scope.rail!.end,
        )
      )
        continue;
      const top =
        this.editor.getTopForLineNumber(scope.line + 1) -
        this.editor.getScrollTop();
      if (top < 0 || top >= this.editor.getLayoutInfo().height) continue;
      if (active || !wanted.has(scope.line))
        wanted.set(scope.line, {
          target: {
            foldable: scope,
            collapsed: this.isFolded(scope),
            rail: false,
            control: false,
          },
          progress,
        });
    }
    for (const [line, control] of this.viewedControls) {
      if (!wanted.has(line)) {
        control.dispose();
        this.viewedControls.delete(line);
      }
    }
    for (const [line, entry] of wanted) {
      let control = this.viewedControls.get(line);
      if (!control) {
        control = this.viewed!.createControl(this.editor, (target) => {
          const path = this.path();
          if (!path) return;
          // Keep the caret out of the body that the viewed mark will fold.
          this.editor.setPosition({
            lineNumber: target.foldable.line + 1,
            column: 1,
          });
          void this.viewed!.toggle(path, target.foldable.foldStateId);
        });
        this.viewedControls.set(line, control);
      }
      control.show(entry.target, entry.progress);
    }
  }

  /** A folded scope on its header line: a chevron to unfold it, then `⋯ N lines` and the closer. */
  private folded(
    model: ITextModel,
    foldable: StructuralFoldable,
    targeted: boolean,
  ): IModelDeltaDecoration[] {
    const line = foldable.line + 1;
    const end = model.getLineMaxColumn(line);
    const inline = foldable.inline!;
    const viewed =
      this.viewed?.get(this.path()!, foldable.foldStateId).state === "viewed";
    return [
      this.chevron(foldable, true, targeted),
      {
        range: new Range(line, end, line, end),
        options: {
          description: "review-fold-pill",
          // Monaco drops text on an empty range without this.
          showIfCollapsed: true,
          after: {
            content: `${viewed ? "✓" : "⋯"} ${inline.label}`,
            inlineClassName: `review-fold-pill${targeted ? " is-target" : ""}${viewed ? " is-viewed" : ""}`,
            cursorStops: InjectedTextCursorStops.None,
            attachedData: PILL,
          },
        },
      },
      {
        range: new Range(line, end, line, end),
        options: {
          description: "review-fold-closer",
          showIfCollapsed: true,
          after: {
            content: inline.closer,
            inlineClassName: "review-fold-closer",
            cursorStops: InjectedTextCursorStops.None,
            attachedData: PILL,
          },
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
    const result: IModelDeltaDecoration[] = foldable.chevron
      ? [this.chevron(foldable, target.collapsed, targeted)]
      : [];
    for (const brace of foldable.braces
      ? [foldable.braces.opener, foldable.braces.closer]
      : []) {
      result.push({
        range: new Range(
          brace.line,
          brace.column,
          brace.line,
          brace.column + 1,
        ),
        options: {
          description: "review-scope-brace",
          inlineClassName: `review-scope-brace${state}`,
        },
      });
    }
    if (targeted && foldable.rail && !mobileViewport.matches) {
      const lines = foldable.rail.end - foldable.rail.start;
      const end = model.getLineMaxColumn(line);
      result.push({
        range: new Range(line, end, line, end),
        options: {
          description: "review-fold-hint",
          showIfCollapsed: true,
          after: {
            content: `click · ${target.collapsed ? "expand" : "fold"} ${lines} line${lines === 1 ? "" : "s"}`,
            inlineClassName: "review-fold-hint",
            cursorStops: InjectedTextCursorStops.None,
          },
        },
      });
    }
    return result;
  }

  private chevron(
    foldable: StructuralFoldable,
    collapsed: boolean,
    targeted: boolean,
  ): IModelDeltaDecoration {
    const line = foldable.line + 1;
    return {
      range: new Range(line, 1, line, 1),
      options: {
        description: CHEVRON,
        linesDecorationsClassName: `${CHEVRON} ${ThemeIcon.asClassName(collapsed ? Codicon.chevronRight : Codicon.chevronDown)}${collapsed ? " is-collapsed" : ""}${targeted ? " is-target" : ""}`,
      },
    };
  }

  private targetAt(e: IEditorMouseEvent): FoldTarget | undefined {
    for (const control of this.viewedControls.values()) {
      const viewed = control.targetOf(
        e.event.browserEvent.target as HTMLElement | null,
      );
      if (viewed) return { ...viewed, rail: false, control: false };
    }
    const model = this.editor.getModel();
    const path = this.path();
    const diff = path ? this.session.getTextDiff(path) : undefined;
    const summary = (
      e.event.browserEvent.target as HTMLElement | null
    )?.closest?.("[data-summary-fold-state-id]");
    if (summary && diff) {
      const foldable = this.foldablesOf(diff).find(
        (f) =>
          f.rail &&
          f.foldStateId ===
            Number(summary.getAttribute("data-summary-fold-state-id")),
      );
      if (foldable)
        return { foldable, rail: true, control: false, collapsed: true };
    }
    const position = e.target.position;
    const rail = this.rails.targetOf(
      e.event.browserEvent.target as HTMLElement | null,
    );
    if (rail) {
      return {
        foldable: rail,
        rail: true,
        control: false,
        collapsed: this.isSummaryFolded(rail),
      };
    }
    if (!model || !path || !diff || !position) {
      return undefined;
    }
    const foldables = this.foldablesOf(diff);
    // A deleted row in the unified view is a view zone after the modified line above it. Inside
    // a body it reads the innermost body around its gap, as a body line does.
    const element = e.event.browserEvent.target as HTMLElement | null;
    if (
      (e.target.type === MouseTargetType.CONTENT_VIEW_ZONE ||
        e.target.type === MouseTargetType.GUTTER_VIEW_ZONE) &&
      element?.closest?.(
        ".line-delete-selectable, .inline-original-margin-view-zone, .inline-deleted-margin-view-zone",
      )
    ) {
      // The zone follows this 1-based line, so it is the 0-based line below the gap.
      const below = e.target.detail.afterLineNumber;
      const around = foldables
        .filter(
          (f) =>
            f.rail &&
            !this.isCollapsed(path, f) &&
            f.rail.start <= below &&
            below <= f.rail.end,
        )
        .sort(
          (a, b) => a.rail!.end - a.rail!.start - (b.rail!.end - b.rail!.start),
        );
      return around[0]
        ? {
            foldable: around[0],
            rail: false,
            control: false,
            collapsed: false,
          }
        : undefined;
    }
    const line = position.lineNumber - 1;
    const content =
      e.target.type === MouseTargetType.CONTENT_TEXT ||
      e.target.type === MouseTargetType.CONTENT_EMPTY;
    const gutter =
      e.target.type === MouseTargetType.GUTTER_GLYPH_MARGIN ||
      e.target.type === MouseTargetType.GUTTER_LINE_NUMBERS ||
      e.target.type === MouseTargetType.GUTTER_LINE_DECORATIONS;
    if (!content && !gutter) {
      return undefined;
    }
    const onChevron = this.inChevronColumn(e);

    // A folded scope's header: its chevron and its pill unfold it.
    const folded = foldables.find(
      (f) => f.line === line && (this.isFolded(f) || this.isSummaryFolded(f)),
    );
    if (folded) {
      const onPill =
        e.target.type === MouseTargetType.CONTENT_TEXT &&
        e.target.detail.injectedText?.options.attachedData === PILL;
      return {
        foldable: folded,
        rail: false,
        control: onChevron || onPill,
        collapsed: true,
      };
    }

    const open = foldables.filter((f) => !this.isCollapsed(path, f));
    const railsHere = open
      .filter((f) => f.rail && f.rail.start <= line && line <= f.rail.end)
      .sort(
        (a, b) => a.rail!.end - a.rail!.start - (b.rail!.end - b.rail!.start),
      );
    if (
      content &&
      e.target.mouseColumn - 1 < leadingWidth(model, position.lineNumber)
    ) {
      const column = e.target.mouseColumn - 1;
      const rail = railsHere.find(
        (f) => leadingWidth(model, f.line + 1) === column,
      );
      if (rail) {
        return {
          foldable: rail,
          rail: true,
          control: false,
          collapsed: this.isSummaryFolded(rail),
        };
      }
    }
    // A scope without a rail (a statement) is a target only from its chevron; elsewhere on its
    // line the pointer reads the innermost body around it, as diffr's TUI does.
    const header = open.find(
      (f) => f.chevron && f.line === line && (f.rail || onChevron),
    );
    if (header) {
      return {
        foldable: header,
        rail: false,
        control: onChevron,
        collapsed: false,
      };
    }
    // A blank spot in the chevron column reveals controls without lighting a scope.
    if (this.inChevronColumn(e)) {
      return undefined;
    }
    // Inside a body, the innermost rail's scope.
    return railsHere[0]
      ? {
          foldable: railsHere[0],
          rail: false,
          control: false,
          collapsed: false,
        }
      : undefined;
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
    return (
      this.session.isRegionCollapsed(path, foldable.foldStateId) ??
      foldable.collapsedByDefault
    );
  }

  private isSummaryFolded(foldable: StructuralFoldable): boolean {
    return (
      !!foldable.rail &&
      this.regions.get().some((region) => {
        if (
          region.foldStateId !== foldable.foldStateId ||
          !bandDetail(region.readLabel(undefined) ?? "")
        )
          return false;
        return !(
          this.side === "rhs"
            ? region.getHiddenModifiedRange(undefined)
            : region.getHiddenOriginalRange(undefined)
        ).isEmpty;
      })
    );
  }

  /** Whether the editor hides the scope's body with no band, so the header shows the fold. */
  private isFolded(foldable: StructuralFoldable): boolean {
    return (
      !!foldable.inline &&
      this.regions.get().some((region) => {
        if (region.band || region.foldStateId !== foldable.foldStateId) {
          return false;
        }
        const hidden =
          this.side === "rhs"
            ? region.getHiddenModifiedRange(undefined)
            : region.getHiddenOriginalRange(undefined);
        return hidden.startLineNumber === foldable.line + 2 && !hidden.isEmpty;
      })
    );
  }
}

/** Scope rails share one clipped overlay, including the gaps occupied by view zones. */
class ScopeRails implements IOverlayWidget {
  readonly allowEditorOverflow = false;
  private readonly node: HTMLElement;
  private readonly targets = new WeakMap<Element, StructuralFoldable>();
  private readonly segments = new Map<StructuralFoldable, HTMLElement>();
  private added = false;

  constructor(private readonly editor: ICodeEditor) {
    this.node = editor.getContainerDomNode().ownerDocument.createElement("div");
    this.node.className = "review-scope-rails";
  }

  getId(): string {
    return "review.scopeRails";
  }
  getDomNode(): HTMLElement {
    return this.node;
  }
  targetOf(element: HTMLElement | null): StructuralFoldable | undefined {
    const rail = element?.closest?.(".review-scope-rail");
    return rail ? this.targets.get(rail) : undefined;
  }

  getPosition(): IOverlayWidgetPosition {
    return {
      preference: { top: 0, left: this.editor.getLayoutInfo().contentLeft },
    };
  }

  show(
    model: ITextModel,
    foldables: readonly StructuralFoldable[],
    target: FoldTarget | undefined,
  ): void {
    const layout = this.editor.getLayoutInfo();
    const scrollTop = this.editor.getScrollTop();
    const scrollLeft = this.editor.getScrollLeft();
    const spaceWidth = this.editor.getOption(EditorOption.fontInfo).spaceWidth;
    this.node.style.display = "";
    this.node.style.width = `${layout.contentWidth}px`;
    this.node.style.height = `${layout.height}px`;
    const segments: HTMLElement[] = [];
    for (const foldable of foldables) {
      // Start after the header, not at the first body line: it may be hidden
      // behind a band, which Monaco maps back onto the header itself.
      const top = Math.max(
        0,
        this.editor.getBottomForLineNumber(foldable.line + 1) - scrollTop,
      );
      const bottom = Math.min(
        layout.height,
        this.editor.getTopForLineNumber(foldable.rail!.end + 1) - scrollTop,
      );
      const left =
        Math.round(leadingWidth(model, foldable.line + 1) * spaceWidth) -
        scrollLeft;
      if (
        bottom <= top ||
        !Number.isFinite(left) ||
        left < 0 ||
        left >= layout.contentWidth
      ) {
        continue;
      }
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
      if (!segments.includes(segment)) {
        this.segments.delete(foldable);
      }
    }
    // Keep the hovered element attached while its paint changes.
    if (
      segments.length !== this.node.children.length ||
      segments.some((segment, i) => this.node.children[i] !== segment)
    ) {
      this.node.replaceChildren(...segments);
    }
    if (this.added) {
      this.editor.layoutOverlayWidget(this);
    } else {
      this.added = true;
      this.editor.addOverlayWidget(this);
    }
  }

  hide(): void {
    // Model attachment can synchronously trigger layout while Monaco iterates
    // its overlay registry. Keep the entry stable until this control is disposed.
    this.node.style.display = "none";
  }
  dispose(): void {
    if (this.added) {
      this.added = false;
      this.editor.removeOverlayWidget(this);
    }
  }
}

/** The visible width of a line's indent. A blank line has no limit, so rails continue through it. */
function leadingWidth(model: ITextModel, lineNumber: number): number {
  const column = model.getLineFirstNonWhitespaceColumn(lineNumber);
  if (column === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return CursorColumns.visibleColumnFromColumn(
    model.getLineContent(lineNumber),
    column,
    model.getOptions().tabSize,
  );
}

/** Native buttons bypass Monaco's mouse-only press/release cycle on touch screens. */
class TouchFoldButtons implements IOverlayWidget {
  private readonly node = document.createElement("div");
  private readonly buttons = new Map<number, HTMLButtonElement>();
  private added = false;
  constructor(
    private readonly editor: ICodeEditor,
    private readonly toggle: (foldable: StructuralFoldable) => void,
  ) {
    this.node.className = "app-touch-folds";
    for (const event of ["pointerdown", "mousedown", "mouseup"])
      this.node.addEventListener(event, (e) => e.stopPropagation());
  }
  getId(): string {
    return "review.touchFolds";
  }
  getDomNode(): HTMLElement {
    return this.node;
  }
  getPosition(): IOverlayWidgetPosition {
    return {
      // Share the number column's hit area rather than reserving extra code width.
      preference: {
        top: 0,
        left: Math.max(0, this.editor.getLayoutInfo().contentLeft - 44),
      },
    };
  }
  show(
    foldables: readonly StructuralFoldable[],
    collapsed: (foldable: StructuralFoldable) => boolean,
  ): void {
    if (!mobileViewport.matches) {
      this.hide();
      return;
    }
    const layout = this.editor.getLayoutInfo();
    const lineHeight = this.editor.getOption(EditorOption.lineHeight);
    const visible = new Set<number>();
    for (const foldable of foldables) {
      const top =
        this.editor.getTopForLineNumber(foldable.line + 1) -
        this.editor.getScrollTop();
      if (top < 0 || top >= layout.height) continue;
      visible.add(foldable.line);
      let button = this.buttons.get(foldable.line);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "app-touch-fold";
        this.buttons.set(foldable.line, button);
        this.node.append(button);
      }
      const folded = collapsed(foldable);
      button.setAttribute(
        "aria-label",
        `${folded ? "Expand" : "Fold"} scope at line ${foldable.line + 1}`,
      );
      button.setAttribute("aria-expanded", String(!folded));
      button.style.top = `${top}px`;
      button.style.width = "44px";
      button.style.height = `${lineHeight}px`;
      button.onclick = (event) => {
        event.stopPropagation();
        this.toggle(foldable);
      };
    }
    for (const [line, button] of this.buttons)
      if (!visible.has(line)) {
        button.remove();
        this.buttons.delete(line);
      }
    this.node.style.height = `${layout.height}px`;
    this.node.style.width = "44px";
    this.node.style.display = "";
    if (this.added) this.editor.layoutOverlayWidget(this);
    else {
      this.added = true;
      this.editor.addOverlayWidget(this);
    }
  }
  hide(): void {
    this.node.style.display = "none";
  }
  dispose(): void {
    if (this.added) {
      this.editor.removeOverlayWidget(this);
      this.added = false;
    }
  }
}
