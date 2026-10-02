/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../base/common/event.js";
import { IServerChannel } from "../../base/parts/ipc/common/ipc.js";
import type { IWindowsMainService } from "../../platform/windows/electron-main/windows.js";
import type { ReviewDesktopConnection } from "../common/reviewDesktopBootstrap.js";
import type { ReviewDesktopHost } from "./reviewDesktopHost.js";

export { REVIEW_DESKTOP_CHANNEL } from "../common/reviewDesktopBootstrap.js";

/**
 * Hands the renderer the endpoint the main process validated. Bootstrap details
 * deliberately do not travel through the window configuration or the process
 * environment: the main process is the only owner of the server credentials.
 */
export class ReviewDesktopChannel implements IServerChannel {
  constructor(
    private readonly host: ReviewDesktopHost,
    private readonly windows: IWindowsMainService,
    private readonly moveToApplications: () => boolean,
  ) {}

  listen<T>(): Event<T> {
    return Event.None as Event<T>;
  }

  async call<T>(_context: string, command: string, arg?: unknown): Promise<T> {
    if (command === "getConnection") {
      const connection: ReviewDesktopConnection = await this.host.whenConnected();
      return connection as T;
    }
    if (command === "stageRustAnalyzer") {
      this.host.stageRustAnalyzer();
      return undefined as T;
    }
    if (command === "moveToApplications") {
      return this.moveToApplications() as T;
    }
    if (command === "closeSourceWindows") {
      this.closeSourceWindows(Array.isArray(arg) ? arg.map(String) : []);
      return undefined as T;
    }
    throw new Error(`Unknown Review Desktop channel call: ${command}`);
  }

  /**
   * A source window opens a workspace file the host writes inside the
   * review's managed checkouts, which dismissal and deletion remove. Closing
   * here, not by window id from a renderer, cannot fall back to closing the
   * caller when the window is already gone.
   */
  private closeSourceWindows(reviewIds: string[]) {
    // The host names the directory with safeStorageSegment(reviewId).
    const roots = reviewIds.map(
      (id) => `/dev-fast/reviews/${id.replace(/[^A-Za-z0-9_.-]+/g, "__")}/`,
    );
    for (const window of this.windows.getWindows()) {
      const workspace = window.openedWorkspace;
      if (
        workspace &&
        "configPath" in workspace &&
        roots.some((root) => workspace.configPath.path.includes(root))
      )
        window.close();
    }
  }
}
