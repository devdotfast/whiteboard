/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from "../../base/common/event.js";
import { Disposable } from "../../base/common/lifecycle.js";
import {
  ConfigurationTarget,
  IConfigurationService,
} from "../../platform/configuration/common/configuration.js";
import type { ReviewDiffLayout } from "../common/reviewProtocol.js";

/**
 * A unified/split choice kept in a boolean user setting, so it outlives the app.
 */
export class ReviewDiffLayoutSetting extends Disposable {
  private readonly _onDidChange = this._register(
    new Emitter<ReviewDiffLayout>(),
  );
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly key: string,
    @IConfigurationService
    private readonly configurationService: IConfigurationService,
  ) {
    super();
    this._register(
      configurationService.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(key)) {
          this._onDidChange.fire(this.get());
        }
      }),
    );
  }

  get(): ReviewDiffLayout {
    return this.configurationService.getValue<boolean>(this.key)
      ? "split"
      : "unified";
  }

  set(layout: ReviewDiffLayout): Promise<void> {
    return this.configurationService.updateValue(
      this.key,
      layout === "split",
      ConfigurationTarget.USER,
    );
  }

  toggle(): Promise<void> {
    return this.set(this.get() === "split" ? "unified" : "split");
  }
}
