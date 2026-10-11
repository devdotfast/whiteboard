/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from "../../base/common/event.js";
import { isAbsolute } from "../../base/common/path.js";
import { IServerChannel } from "../../base/parts/ipc/common/ipc.js";
import type { IDialogMainService } from "../../platform/dialogs/electron-main/dialogMainService.js";
import type { IWindowsMainService } from "../../platform/windows/electron-main/windows.js";
import type { ReviewDesktopConnection } from "../common/reviewDesktopBootstrap.js";
import { editorPosition, externalEditorUrl, type ReviewExternalEditorTarget } from "../common/reviewExternalEditor.js";
import type { ReviewDesktopHost } from "./reviewDesktopHost.js";
import { applicationPickerOptions, launchApplication, launchExternalEditorUrl, launchZedWorkspace } from "./reviewExternalEditorLauncher.js";

/** How the channel reaches outside Whiteboard; tests replace it. */
export interface ReviewExternalLauncher {
  openUrl(url: string): Promise<void>;
  openInApplication(application: string, filePath: string): Promise<void>;
  /** False where Zed's command line is not found. */
  openZedWorkspace(folder: string, file: string): Promise<boolean>;
}

const externalLauncher: ReviewExternalLauncher = {
  openUrl: (url) => launchExternalEditorUrl(url),
  openInApplication: (application, filePath) => launchApplication(application, filePath),
  openZedWorkspace: (folder, file) => launchZedWorkspace(folder, file),
};

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
    private readonly dialogs: Pick<IDialogMainService, "showOpenDialog">,
    private readonly launcher: ReviewExternalLauncher = externalLauncher,
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
    if (command === "openInExternalEditor") {
      // Only a known editor's file URL leaves here: the renderer names the
      // file, never the URL or the program that opens it.
      const target = (arg ?? {}) as ReviewExternalEditorTarget;
      const url = externalEditorUrl(target);
      if (!url) throw new Error("Not a file Whiteboard can open in an external editor.");
      const folder = typeof target.folder === "string" && isAbsolute(target.folder) ? target.folder : undefined;
      if (folder && target.editor === "zed") {
        // Zed opens each URL in a window of its own, so its command line
        // takes the folder and file together when it can.
        if (await this.launcher.openZedWorkspace(folder, target.filePath + editorPosition(target.line, target.column))) return undefined as T;
      } else {
        // The folder first: the editor then puts the file in the window that
        // has its checkout open, with the file tree beside it.
        const folderUrl = folder && externalEditorUrl({ editor: target.editor, filePath: folder });
        if (folderUrl) await this.launcher.openUrl(folderUrl);
      }
      await this.launcher.openUrl(url);
      return undefined as T;
    }
    if (command === "openInApplication") {
      const { application, filePath } = (arg ?? {}) as { application?: unknown; filePath?: unknown };
      if (typeof application !== "string" || typeof filePath !== "string" || !isAbsolute(application) || !isAbsolute(filePath))
        throw new Error("Not a file and application Whiteboard can open.");
      await this.launcher.openInApplication(application, filePath);
      return undefined as T;
    }
    if (command === "chooseApplication") {
      const parent = this.windows.getFocusedWindow()?.win ?? undefined;
      const result = await this.dialogs.showOpenDialog(applicationPickerOptions(process.platform), parent);
      return (result.canceled ? null : result.filePaths[0] ?? null) as T;
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
