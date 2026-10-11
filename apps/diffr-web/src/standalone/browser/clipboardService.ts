/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// The fork dropped VS Code's browser clipboard service; a read-only diff
// page needs only copying text out.
import type { URI } from "vs/base/common/uri.js";
import type { IClipboardService } from "vs/platform/clipboard/common/clipboardService.js";

export class BrowserClipboardService implements IClipboardService {
  declare readonly _serviceBrand: undefined;
  private findText = "";

  triggerPaste(): Promise<void> | undefined {
    return undefined;
  }
  async writeText(text: string): Promise<void> {
    await navigator.clipboard?.writeText(text);
  }
  async readText(): Promise<string> {
    return (await navigator.clipboard?.readText()) ?? "";
  }
  async readFindText(): Promise<string> {
    return this.findText;
  }
  async writeFindText(text: string): Promise<void> {
    this.findText = text;
  }
  async writeResources(_resources: URI[]): Promise<void> {}
  async readResources(): Promise<URI[]> {
    return [];
  }
  async hasResources(): Promise<boolean> {
    return false;
  }
  async readImage(): Promise<Uint8Array> {
    return new Uint8Array();
  }
}
