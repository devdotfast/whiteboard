import { Dimension } from "vs/base/browser/dom.js";
import { Disposable } from "vs/base/common/lifecycle.js";
import type { ICodeEditor } from "vs/editor/browser/editorBrowser.js";
import type { MultiDiffEditorWidget } from "vs/editor/browser/widget/multiDiffEditor/multiDiffEditorWidget.js";

import { element } from "./ui.js";

export const mobileViewport = window.matchMedia("(max-width: 760px)");

/** Let the browser own touch inertia; Monaco still owns virtualized diffs and structural folds. */
export class NativeDiffScroll extends Disposable {
  readonly viewport = element("div", "app-diff-viewport");
  private readonly scroller = element("div", "app-native-scroll");
  private readonly extent = element("div", "app-native-scroll-extent");
  private enabled = false;
  private syncing = false;
  private widget: MultiDiffEditorWidget | undefined;

  constructor(parent: HTMLElement) {
    super();
    this.extent.append(this.viewport);
    this.scroller.append(this.extent);
    parent.append(this.scroller);
    this.scroller.addEventListener(
      "scroll",
      () => {
        if (!this.enabled || this.syncing || !this.widget) return;
        this.syncing = true;
        this.widget.setScrollTop(this.scroller.scrollTop);
        this.syncing = false;
      },
      { passive: true },
    );

    // Monaco's document-level Gesture handler prevents native scrolling, including inertia.
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      this.scroller.addEventListener(
        type,
        (event) => {
          if (this.enabled) event.stopPropagation();
        },
        { passive: true },
      );
    }

    // Leave fold pills and gutters to Monaco. Plain text uses the browser's selection handles.
    for (const type of ["pointerdown", "mousedown", "contextmenu"]) {
      this.scroller.addEventListener(
        type,
        (event) => {
          if (!this.enabled || !(event.target instanceof Element)) return;

          if (
            event.target.closest(".view-line") &&
            !event.target.closest(
              ".review-fold-pill, .review-fold-hint, .review-fold-closer",
            )
          )
            event.stopPropagation();
        },
        true,
      );
    }

    const copy = (event: ClipboardEvent) => {
      if (!this.enabled) return;
      const selection = window.getSelection();

      if (
        !selection ||
        selection.isCollapsed ||
        !selection.anchorNode ||
        !this.viewport.contains(selection.anchorNode)
      )
        return;
      // Monaco renders ordinary spaces as non-breaking spaces to preserve code indentation.
      event.clipboardData?.setData(
        "text/plain",
        selection.toString().replace(/\u00a0/g, " "),
      );

      if (event.clipboardData) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // Copy targets the focused element, which can be outside the selected code.
    document.addEventListener("copy", copy, true);
    this._register({
      dispose: () => document.removeEventListener("copy", copy, true),
    });
  }

  attach(widget: MultiDiffEditorWidget): void {
    this.widget = widget;
    this._register(widget.onDidChangeContentHeight(() => this.updateExtent()));
    this._register(
      widget.onDidScroll(() => {
        if (!this.enabled || this.syncing) return;
        this.syncing = true;
        this.scroller.scrollTop = widget.getScrollTop();
        this.syncing = false;
      }),
    );
  }

  layout(width: number, height: number): void {
    const enabled = mobileViewport.matches;
    const top = this.widget?.getScrollTop() ?? 0;
    this.enabled = enabled;
    this.scroller.classList.toggle("is-native", enabled);
    this.viewport.style.height = `${height}px`;
    this.widget?.layout(new Dimension(width, height));
    this.updateExtent();

    if (enabled) this.scroller.scrollTop = top;
  }

  private updateExtent(): void {
    this.extent.style.height = this.enabled
      ? `${Math.max(this.scroller.clientHeight, this.widget?.getContentHeight() ?? 0)}px`
      : "100%";
  }
}

/** Monaco owns horizontal geometry; the browser retains vertical touch inertia. */
export function horizontalTouchScroll(editor: ICodeEditor) {
  const node = editor.getContainerDomNode();

  let gesture:
    | {
        x: number;
        y: number;
        lastX: number;
        time: number;
        horizontal?: boolean;
        velocity: number;
      }
    | undefined;

  let frame = 0;

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const start = (event: TouchEvent) => {
    stop();
    gesture = undefined;

    if (
      !mobileViewport.matches ||
      event.touches.length !== 1 ||
      !window.getSelection()?.isCollapsed
    )
      return;
    const touch = event.touches[0];
    gesture = {
      x: touch.clientX,
      y: touch.clientY,
      lastX: touch.clientX,
      time: performance.now(),
      velocity: 0,
    };
  };

  const move = (event: TouchEvent) => {
    if (!gesture || event.touches.length !== 1) {
      gesture = undefined;

      return;
    }

    const x = event.touches[0].clientX;
    const y = event.touches[0].clientY;

    if (gesture.horizontal === undefined) {
      if (Math.max(Math.abs(x - gesture.x), Math.abs(y - gesture.y)) < 8)
        return;
      gesture.horizontal = Math.abs(x - gesture.x) > Math.abs(y - gesture.y);
    }

    if (!gesture.horizontal) return;
    event.preventDefault();
    const now = performance.now();
    const delta = gesture.lastX - x;
    gesture.velocity = delta / Math.max(1, now - gesture.time);
    editor.setScrollLeft(editor.getScrollLeft() + delta);
    gesture.lastX = x;
    gesture.time = now;
  };

  const end = () => {
    const finished = gesture;
    gesture = undefined;

    if (!finished?.horizontal || performance.now() - finished.time > 100)
      return;
    let velocity = finished.velocity;
    let last = performance.now();

    const coast = (now: number) => {
      const elapsed = Math.min(32, now - last);
      last = now;
      const before = editor.getScrollLeft();
      editor.setScrollLeft(before + velocity * elapsed);
      velocity *= Math.exp(-elapsed / 180);

      if (
        Math.abs(velocity) > 0.02 &&
        editor.getScrollLeft() !== before &&
        mobileViewport.matches
      )
        frame = requestAnimationFrame(coast);
    };

    frame = requestAnimationFrame(coast);
  };

  const cancel = () => {
    gesture = undefined;
    stop();
  };

  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchmove", move, { passive: false });
  node.addEventListener("touchend", end);
  node.addEventListener("touchcancel", cancel);
  const modelChange = editor.onDidChangeModel(cancel);

  return {
    dispose() {
      cancel();
      modelChange.dispose();
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", cancel);
    },
  };
}
