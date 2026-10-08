/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from "vs/base/common/event.js";
import { Disposable } from "vs/base/common/lifecycle.js";

import { readSetting, writeSetting } from "../../settings.js";

export type ReviewDiffLayout = "split" | "unified";

/** The unified/split choice, remembered in this browser. */
export class ReviewDiffLayoutSetting extends Disposable {
  private readonly _onDidChange = this._register(
    new Emitter<ReviewDiffLayout>(),
  );
  readonly onDidChange = this._onDidChange.event;
  private layout: ReviewDiffLayout =
    readSetting("layout") === "unified" ? "unified" : "split";

  get(): ReviewDiffLayout {
    return this.layout;
  }

  async set(layout: ReviewDiffLayout): Promise<void> {
    if (layout === this.layout) return;
    this.layout = layout;
    writeSetting("layout", layout);
    this._onDidChange.fire(layout);
  }

  toggle(): Promise<void> {
    return this.set(this.layout === "split" ? "unified" : "split");
  }
}
