/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// Review Desktop's session reads one diffr stream in order. In the browser
// files are diffed on demand, nearest the reader first, so results arrive
// in any order through `setFileResult`; the views observe it the same way.
import { RunOnceScheduler } from "vs/base/common/async.js";
import { CancellationError } from "vs/base/common/errors.js";
import { Emitter } from "vs/base/common/event.js";
import { Disposable } from "vs/base/common/lifecycle.js";

import type { StructuralDiff } from "../../protocol.js";
import type {
  StructuralRegion,
  StructuralTextDiff,
} from "../common/reviewStructuralDiff.js";

export interface StructuralFileResult {
  diff?: StructuralDiff;
  error?: string;
  hidden?: string;
}

export interface StructuralSessionChange {
  /** Files whose diff or fold state changed. */
  readonly files: ReadonlySet<string>;
  readonly status: boolean;
}

/** One comparison. Views only observe it and change fold state. */
export class StructuralDiffSession extends Disposable {
  private readonly changed = this._register(
    new Emitter<StructuralSessionChange>(),
  );
  readonly onDidChange = this.changed.event;
  private readonly pendingFiles = new Set<string>();
  private pendingStatus = false;
  private readonly notification = this._register(
    new RunOnceScheduler(() => this.flushChanges(), 16),
  );
  private readonly results = new Map<string, StructuralFileResult>();
  private readonly folds = new Map<string, boolean>();
  private disposed = false;
  error: string | undefined;
  get complete(): boolean {
    return this.results.size === this.manifest.size;
  }

  constructor(private readonly manifest: ReadonlySet<string>) {
    super();
  }

  getFileResult(path: string): StructuralFileResult | undefined {
    return this.results.get(path);
  }
  /** Wait only for this file; a view can render while other files are diffed. */
  fileResult(path: string): Promise<StructuralFileResult> {
    const current = this.results.get(path);
    if (current) return Promise.resolve(current);
    if (this.disposed) return Promise.reject(new CancellationError());
    return new Promise((resolve, reject) => {
      const listener = this.onDidChange((change) => {
        if (this.disposed) {
          listener.dispose();
          reject(new CancellationError());
          return;
        }
        const result = change.files.has(path)
          ? this.results.get(path)
          : undefined;
        if (result) {
          listener.dispose();
          resolve(result);
        }
      });
    });
  }
  getTextDiff(path: string): StructuralTextDiff | undefined {
    const diff = this.results.get(path)?.diff;
    return diff?.type === "text" ? diff : undefined;
  }
  isRegionCollapsed(path: string, id: number): boolean | undefined {
    return this.folds.get(`${path}:${id}`);
  }
  setRegionCollapsed(path: string, id: number, collapsed: boolean): void {
    const key = `${path}:${id}`;
    if (this.disposed || this.folds.get(key) === collapsed) return;
    this.folds.set(key, collapsed);
    this.notify(path);
  }

  /** One file's result, once: its diff, or why it has none. */
  setFileResult(path: string, result: StructuralFileResult): void {
    if (this.disposed) return;
    if (!this.manifest.has(path) || this.results.has(path))
      throw new Error(`Unexpected or repeated diffr result: ${path}`);
    const diff = result.diff;
    if (diff?.type === "text") {
      const seed = (region: StructuralRegion) => {
        const key = `${path}:${region.fold_state_id}`;
        if (!this.folds.has(key))
          this.folds.set(key, region.visibility?.collapsed === true);
        if (region.kind === "fold") region.children.forEach(seed);
      };
      for (const side of [diff.lhs, diff.rhs]) if (side) seed(side.root);
    }
    const visibility =
      diff?.type === "text"
        ? [diff.rhs, diff.lhs].find((side) => side?.root.visibility?.collapsed)
            ?.root.visibility
        : undefined;
    this.results.set(path, {
      ...result,
      hidden:
        result.hidden ??
        (visibility ? visibility.label || "Hidden by default" : undefined),
    });
    this.notify(path, this.complete);
  }

  /** The comparison could not be loaded at all. */
  fail(error: string): void {
    this.error = error;
    this.notify(undefined, true);
  }

  private notify(path?: string, status = false): void {
    if (path) this.pendingFiles.add(path);
    this.pendingStatus ||= status;
    if (!this.notification.isScheduled()) this.notification.schedule();
  }

  private flushChanges(): void {
    if (!this.pendingFiles.size && !this.pendingStatus) return;
    const change: StructuralSessionChange = {
      files: new Set(this.pendingFiles),
      status: this.pendingStatus,
    };
    this.pendingFiles.clear();
    this.pendingStatus = false;
    this.changed.fire(change);
  }

  override dispose(): void {
    this.disposed = true;
    this.changed.fire({ files: new Set(), status: true });
    this.results.clear();
    this.folds.clear();
    this.pendingFiles.clear();
    super.dispose();
  }
}
