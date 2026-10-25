/*---------------------------------------------------------------------------------------------
 * Copyright (c) dev.fast. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
  getWindow,
  scheduleAtNextAnimationFrame,
} from "../../base/browser/dom.js";
import { Disposable, MutableDisposable } from "../../base/common/lifecycle.js";
import type { ICodeEditor } from "../../editor/browser/editorBrowser.js";
import { EditorOption } from "../../editor/common/config/editorOptions.js";
import type { IAccessibilityService } from "../../platform/accessibility/common/accessibility.js";

/** The Ask pin spans the existing two glyph lanes, each one source-line height. */
export class AskPinLane extends Disposable {
  private readonly frame = this._register(new MutableDisposable());
  private animation: Animation | undefined;
  private width = 0;
  private target = 0;
  private hasPins = false;
  private model = this.editor.getModel()?.id;

  constructor(
    private readonly editor: ICodeEditor,
    private readonly accessibility: IAccessibilityService,
  ) {
    super();
    this.apply(0);
    this._register(
      accessibility.onDidChangeReducedMotion(() => {
        if (accessibility.isMotionReduced()) {
          this.stop();
          this.apply(this.target);
        }
      }),
    );
    this._register(
      editor.onDidChangeConfiguration((event) => {
        if (event.hasChanged(EditorOption.lineHeight))
          this.setHasPins(this.hasPins);
        if (
          event.hasChanged(EditorOption.glyphMarginWidth) &&
          editor.getOption(EditorOption.glyphMarginWidth) !== this.width
        )
          editor.updateOptions({ glyphMarginWidth: this.width });
      }),
    );
    this._register({
      dispose: () => {
        this.stop();
        const style = editor.getContainerDomNode().style;
        style.removeProperty("--review-pin-lane-opacity");
        style.removeProperty("--review-pin-lane-pointer-events");
      },
    });
  }

  setHasPins(hasPins: boolean): void {
    const model = this.editor.getModel()?.id;
    if (model !== this.model) {
      this.stop();
      this.model = model;
      this.target = 0;
      this.apply(0);
    }
    this.hasPins = hasPins;
    const target = hasPins
      ? 2 * this.editor.getOption(EditorOption.lineHeight)
      : 0;
    if (target === this.target) return;
    this.stop();
    this.target = target;
    if (
      this.accessibility.isMotionReduced() ||
      !this.editor.getContainerDomNode().isConnected
    ) {
      this.apply(target);
      return;
    }
    const from = this.width;
    const win = getWindow(this.editor.getContainerDomNode());
    // Use the browser's timing engine; only Monaco, not a CSS transform,
    // moves the gutter, code, fold rails and their pointer hit targets.
    const effect = new win.KeyframeEffect(null, [], {
      duration: 200,
      easing: "cubic-bezier(.2,0,0,1)",
      fill: "both",
    });
    const animation = new win.Animation(effect, win.document.timeline);
    this.animation = animation;
    animation.play();
    const step = () => {
      const progress = effect.getComputedTiming().progress ?? 0;
      this.apply(from + (target - from) * progress);
      if (animation.playState === "finished") {
        this.apply(target);
        this.stop();
      } else this.frame.value = scheduleAtNextAnimationFrame(win, step);
    };
    this.frame.value = scheduleAtNextAnimationFrame(win, step);
  }

  private apply(width: number): void {
    this.width = Math.round(width);
    this.editor.updateOptions({ glyphMarginWidth: this.width });
    const full = 2 * this.editor.getOption(EditorOption.lineHeight);
    const style = this.editor.getContainerDomNode().style;
    style.setProperty(
      "--review-pin-lane-opacity",
      String(Math.min(1, this.width / full)),
    );
    style.setProperty(
      "--review-pin-lane-pointer-events",
      this.width >= full ? "auto" : "none",
    );
  }
  private stop(): void {
    this.frame.clear();
    this.animation?.cancel();
    this.animation = undefined;
  }
}
