import { Disposable } from "vs/base/common/lifecycle.js";
import type {
  ICodeEditor,
  IOverlayWidget,
  IOverlayWidgetPosition,
} from "vs/editor/browser/editorBrowser.js";
import { EditorOption } from "vs/editor/common/config/editorOptions.js";
import type { IHoverService } from "vs/platform/hover/browser/hover.js";

import { ReviewViewedCheckbox } from "../browser/reviewTooltip.js";
import type { FoldTarget } from "./reviewStructuralFolds.js";
import type { StructuralViewedState } from "./reviewStructuralViewed.js";

/** A scope header action, persistent when viewed and otherwise shown on hover. */
export class ScopeViewedControl extends Disposable implements IOverlayWidget {
  private static nextId = 0;
  private readonly id = `review.scopeViewed.${ScopeViewedControl.nextId++}`;
  readonly allowEditorOverflow = false;
  private readonly node: HTMLElement;
  private readonly additions: HTMLElement;
  private readonly deletions: HTMLElement;
  private readonly status: HTMLElement;
  private readonly check: ReviewViewedCheckbox;
  private target: FoldTarget | undefined;
  private added = false;
  private top = 0;

  constructor(
    private readonly editor: ICodeEditor,
    hoverService: IHoverService,
    onToggle: (target: FoldTarget) => void,
  ) {
    super();
    const document = editor.getContainerDomNode().ownerDocument;
    this.node = document.createElement("div");
    this.node.className = "review-scope-viewed-control";
    this.additions = document.createElement("span");
    this.additions.className = "review-multidiff-additions";
    this.deletions = document.createElement("span");
    this.deletions.className = "review-multidiff-deletions";
    this.status = document.createElement("span");
    this.status.className = "review-scope-viewed-status";
    this.check = this._register(
      new ReviewViewedCheckbox(hoverService, document, () => {
        if (this.target) onToggle(this.target);
      }),
    );
    this.node.append(
      this.additions,
      this.deletions,
      this.status,
      this.check.element,
    );
    this._register({ dispose: () => this.hide() });
  }

  getId(): string {
    return this.id;
  }
  getDomNode(): HTMLElement {
    return this.node;
  }
  getPosition(): IOverlayWidgetPosition {
    return { preference: this.place() };
  }
  /** At the right of the code area, on the scope's header line. */
  private place(): { top: number; left: number } {
    const layout = this.editor.getLayoutInfo();
    return {
      top: this.top,
      left:
        layout.contentLeft + layout.contentWidth - this.node.offsetWidth - 12,
    };
  }
  targetOf(element: HTMLElement | null): FoldTarget | undefined {
    return element && this.node.contains(element) ? this.target : undefined;
  }

  show(
    target: FoldTarget,
    progress: ReturnType<StructuralViewedState["get"]>,
  ): void {
    // Unified diffs retain a narrow original editor for their gutter.
    // It has no code area and must not render a second viewed checkbox.
    if (this.editor.getLayoutInfo().width < 60) {
      this.hide();
      return;
    }
    const line = target.foldable.line + 1;
    const lineHeight = this.editor.getOption(EditorOption.lineHeight);
    const height = Math.max(22, lineHeight);
    this.top =
      this.editor.getTopForLineNumber(line) -
      this.editor.getScrollTop() -
      (height - lineHeight) / 2;
    if (
      this.top < 0 ||
      this.top + height > this.editor.getLayoutInfo().height
    ) {
      this.hide();
      return;
    }
    this.target = target;
    this.node.style.height = `${height}px`;
    this.additions.textContent = progress.remaining.additions
      ? `+${progress.remaining.additions}`
      : "";
    this.deletions.textContent = progress.remaining.deletions
      ? `−${progress.remaining.deletions}`
      : "";
    this.status.textContent = progress.state === "viewed" ? "Viewed" : "";
    const subject =
      this.editor.getModel()?.getLineContent(line).trim() ?? "scope";
    this.check.update(progress.state, subject, false);
    if (!this.added) {
      this.added = true;
      this.editor.addOverlayWidget(this);
    }
    this.editor.layoutOverlayWidget(this);
    // The editor places overlay widgets when it next renders, which a hover alone may not cause
    // for a while; until then a new control would sit in the editor's top left corner.
    const { top, left } = this.place();
    this.node.style.top = `${top}px`;
    this.node.style.left = `${left}px`;
  }

  hide(): void {
    this.target = undefined;
    if (this.added) {
      this.added = false;
      this.editor.removeOverlayWidget(this);
    }
  }
}
