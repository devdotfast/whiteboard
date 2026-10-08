/**
 * One pull request or comparison on the page: its files listed from GitHub, each diffed by diffr in
 * a worker once its text is fetched, nearest the reader first, into Review Desktop's multi-diff view.
 * A file joins the list once diffed; the list keeps the reader's place as files arrive above.
 */
import { Emitter } from "vs/base/common/event.js";
import { Disposable, DisposableStore } from "vs/base/common/lifecycle.js";
import { URI } from "vs/base/common/uri.js";
import { IHoverService } from "vs/platform/hover/browser/hover.js";
import type { IInstantiationService } from "vs/platform/instantiation/common/instantiation.js";

import type { Classified, Engine, FileRequest } from "./engine/engine.js";
import {
  type Change,
  type ChangedFile,
  type Preview,
  type Target,
  fileText,
  loadChange,
  targetPath,
} from "./github.js";
import type { ReviewDiffFileWire, StructuralLineCounts } from "./protocol.js";
import { orderReviewDiffFiles } from "./review/common/reviewChangedFilesModel.js";
import { reviewFileCounts } from "./review/common/reviewStructuralDiff.js";
import type { ReviewDiffLayoutSetting } from "./review/services/reviewDiffLayout.js";
import {
  ReviewFilesDiffView,
  type ReviewFilesEditorEntry,
  ReviewFilesEditorInput,
} from "./review/services/reviewFilesDiffView.js";
import { createStructuralDiffEditors } from "./review/services/reviewStructuralDiff.js";
import { StructuralDiffSession } from "./review/services/reviewStructuralDiffSession.js";
import { StructuralViewedState } from "./review/services/reviewStructuralViewed.js";
import { ScopeViewedControl } from "./review/services/reviewStructuralViewedControl.js";
import { ViewedProgress } from "./viewed.js";

/** Files fetched or diffed at once. The engine spreads them over its workers. */
const IN_FLIGHT = 12;

/** Milliseconds from page start, for the engine panel. */
export interface Timing {
  listed?: number;
  previewed?: number;
  firstDiff?: number;
  done?: number;
}

export interface Work {
  fetching: number;
  diffing: number;
  diffed: number;
  hidden: number;
  failed: number;
  /** Total diffr time, and the file that took longest. */
  diffMs: number;
  slowest?: { path: string; ms: number };
}

interface File {
  changed: ChangedFile;
  entry: ReviewFilesEditorEntry;
  classified?: Classified;
  state: "waiting" | "fetching" | "diffing" | "done";
}

export class Comparison extends Disposable {
  private readonly changed = this._register(new Emitter<void>());
  /** The title, timing or work counts changed. */
  readonly onDidChange = this.changed.event;
  readonly timing: Timing = {};
  readonly work: Work = {
    fetching: 0,
    diffing: 0,
    diffed: 0,
    hidden: 0,
    failed: 0,
    diffMs: 0,
  };
  preview: Preview | undefined;
  change: Change | undefined;
  error: string | undefined;
  private readonly files = new Map<string, File>();
  private order: string[] = [];
  private view: ReviewFilesDiffView | undefined;
  private session: StructuralDiffSession | undefined;
  private viewed: ViewedProgress | undefined;
  /** Files the reader asked for, most recent first. */
  private requested: string[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly overflow: HTMLElement,
    readonly target: Target,
    private readonly engine: Engine,
    private readonly layout: ReviewDiffLayoutSetting,
    private readonly instantiation: IInstantiationService,
  ) {
    super();
    void this.load().catch((error: Error) => {
      if (this._store.isDisposed) return;
      this.error = error.message;
      this.session?.fail(error.message);
      this.changed.fire();
    });
  }

  get title(): string | undefined {
    return (this.change ?? this.preview)?.title;
  }

  get url(): string | undefined {
    return (this.change ?? this.preview)?.url;
  }

  get fileCount(): number {
    return this.files.size;
  }

  /** Lines added and removed so far, from diffr, or GitHub's totals while files are still waiting. */
  get counts(): StructuralLineCounts {
    const change = this.change ?? this.preview;

    if (this.work.diffed < this.files.size && change?.additions !== undefined)
      return { added: change.additions, removed: change.deletions ?? 0 };

    let added = 0,
      removed = 0;

    for (const path of this.order) {
      const diff = this.session?.getFileResult(path)?.diff;

      if (diff?.type !== "text") continue;
      added += diff.stats.visible.added;
      removed += diff.stats.visible.removed;
    }

    return { added, removed };
  }

  focus(): void {
    this.view?.focus();
  }

  private async load(): Promise<void> {
    const change = await loadChange(this.target, (preview) => {
      this.preview = preview;
      this.changed.fire();
    });

    if (this._store.isDisposed) return;
    this.change = change;
    this.timing.listed = performance.now();
    this.changed.fire();

    const wires = new Map<ReviewDiffFileWire, ChangedFile>();

    for (const file of change.files) {
      wires.set(
        {
          path: file.path,
          previousPath: file.previousPath,
          status: file.status === "copied" ? "renamed" : file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        },
        file,
      );
    }

    const ordered = orderReviewDiffFiles([...wires.keys()]);
    const { owner, repo } = this.target;

    const blob = (commit: string, path: string) =>
      URI.from({
        scheme: "https",
        authority: "github.com",
        path: `/${owner}/${repo}/blob/${commit}/${path}`,
      });

    const entries: ReviewFilesEditorEntry[] = ordered.map((file) => ({
      file,
      original: URI.from({
        scheme: "diffr",
        authority: "base",
        path: `/${file.previousPath ?? file.path}`,
      }),
      modified: URI.from({
        scheme: "diffr",
        authority: "head",
        path: `/${file.path}`,
      }),
      goToFileResource:
        file.status === "deleted"
          ? blob(change.base, file.previousPath ?? file.path)
          : blob(change.head, file.path),
    }));

    for (const entry of entries)
      this.files.set(entry.file.path, {
        changed: wires.get(entry.file)!,
        entry,
        state: "waiting",
      });
    this.order = entries.map((entry) => entry.file.path);

    const store = this._register(new DisposableStore());

    const session = (this.session = store.add(
      new StructuralDiffSession(new Set(this.order)),
    ));

    const viewed = (this.viewed = store.add(
      new ViewedProgress(targetPath(this.target)),
    ));

    const hover = this.instantiation.invokeFunction((accessor) =>
      accessor.get(IHoverService),
    );

    const viewedState = store.add(
      new StructuralViewedState(
        session,
        entries,
        () => viewed.progress,
        viewed.onDidChange,
        (ranges, isViewed) => viewed.setViewed(ranges, isViewed),
        (editor, onToggle) => new ScopeViewedControl(editor, hover, onToggle),
      ),
    );

    const structural = createStructuralDiffEditors(
      this.instantiation,
      entries,
      store,
      session,
      viewedState,
    );

    const input = store.add(
      structural.instantiation.createInstance(
        ReviewFilesEditorInput,
        entries,
        session,
      ),
    );

    const view = (this.view = store.add(
      structural.instantiation.createInstance(
        ReviewFilesDiffView,
        this.container,
        this.overflow,
        this.layout,
        undefined,
        (path: string) => void viewed.toggleFile(path),
        undefined,
        undefined,
      ),
    ));

    view.setProgress(viewed.progress);
    store.add(viewed.onDidChange(() => view.setProgress(viewed.progress)));
    view.startLoading(entries);
    store.add(
      view.onDidRequestFile((path) => {
        this.requested = [path, ...this.requested.filter((p) => p !== path)];
        this.pump();
      }),
    );
    store.add(view.onDidScroll(() => this.pump()));
    this.observe(session, entries, view, store);
    await view.setInput(input, undefined);

    if (this._store.isDisposed) return;

    // Paths alone say which files diffr hides (generated, vendored, lockfiles); those go last.
    const previews = await this.engine.preview(
      entries.map((entry) => this.request(this.files.get(entry.file.path)!)),
    );

    if (this._store.isDisposed) return;
    previews.forEach((preview, index) => {
      if (!("error" in preview))
        this.files.get(this.order[index]!)!.classified = preview;
    });
    this.work.hidden = [...this.files.values()].filter(
      (file) => file.classified?.hidden,
    ).length;
    this.timing.previewed = performance.now();
    this.changed.fire();
    this.pump();
  }

  /** What diffr is told about a file: its sides, with their text once fetched. */
  private request(
    file: File,
    text?: { lhs?: string; rhs?: string },
  ): FileRequest {
    const { changed } = file;
    const base = changed.previousPath ?? changed.path;

    return {
      status: changed.status,
      // The base blob's id is not in GitHub's listing; any id names the text diffr is given.
      lhs:
        changed.status === "added"
          ? undefined
          : {
              path: base,
              oid: `base:${base}`,
              mode: "100644",
              text: text?.lhs,
            },
      rhs:
        changed.status === "deleted"
          ? undefined
          : {
              path: changed.path,
              oid: changed.sha ?? `head:${changed.path}`,
              mode: "100644",
              text: text?.rhs,
            },
    };
  }

  /** The next file to diff: one the reader asked for, else the nearest after the one on screen. */
  private next(): File | undefined {
    for (const path of this.requested) {
      const file = this.files.get(path);

      if (file?.state === "waiting") return file;
    }

    const active = this.view?.activePath;
    const anchor = Math.max(0, active ? this.order.indexOf(active) : 0);

    let best: File | undefined,
      bestScore = Infinity;

    this.order.forEach((path, index) => {
      const file = this.files.get(path)!;

      if (file.state !== "waiting") return;
      // Ahead of the reader first; files behind cost double; hidden ones wait for the rest.
      const distance = index >= anchor ? index - anchor : (anchor - index) * 2;
      const score = distance + (file.classified?.hidden ? 1e6 : 0);

      if (score < bestScore) [best, bestScore] = [file, score];
    });

    return best;
  }

  private pump(): void {
    if (
      !this.session ||
      this.timing.previewed === undefined ||
      this._store.isDisposed
    )
      return;

    while (this.work.fetching + this.work.diffing < IN_FLIGHT) {
      const file = this.next();

      if (!file) break;
      void this.diff(file);
    }
  }

  private async diff(file: File): Promise<void> {
    const { changed, entry } = file;
    const change = this.change!;
    const session = this.session!;
    file.state = "fetching";
    this.work.fetching++;
    this.changed.fire();

    try {
      const [lhs, rhs] = await Promise.all([
        changed.status === "added"
          ? undefined
          : fileText(
              this.target,
              change.base,
              changed.previousPath ?? changed.path,
            ),
        changed.status === "deleted"
          ? undefined
          : fileText(this.target, change.head, changed.path),
      ]);

      if (this._store.isDisposed) return;
      this.work.fetching--;
      this.work.diffing++;
      file.state = "diffing";
      this.changed.fire();
      const diffed = await this.engine.diff(this.request(file, { lhs, rhs }));

      if (this._store.isDisposed) return;
      this.work.diffing--;
      this.work.diffMs += diffed.ms;

      if (!this.work.slowest || diffed.ms > this.work.slowest.ms)
        this.work.slowest = { path: changed.path, ms: diffed.ms };
      const event = diffed.event;

      if (event.diff) {
        // diffr decides what is binary, from the bytes.
        if (event.diff.type === "binary") entry.file.binary = true;
        this.viewed!.addFile(
          changed.path,
          changed.previousPath,
          changed.sha ?? "deleted",
          event.diff,
        );
        session.setFileResult(changed.path, {
          diff: event.diff,
          hidden: diffed.classified.hidden,
        });
      } else {
        this.work.failed++;
        session.setFileResult(changed.path, { error: event.error.message });
      }
    } catch (error) {
      if (this._store.isDisposed) return;

      if (file.state === "fetching") this.work.fetching--;
      else this.work.diffing--;
      this.work.failed++;
      session.setFileResult(changed.path, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    file.state = "done";
    this.work.diffed++;
    this.timing.firstDiff ??= performance.now();

    if (this.work.diffed === this.files.size)
      this.timing.done = performance.now();
    this.changed.fire();
    this.pump();
  }

  /** Review Desktop's observeSession: each result goes to the view once. */
  private observe(
    session: StructuralDiffSession,
    entries: readonly ReviewFilesEditorEntry[],
    view: ReviewFilesDiffView,
    store: DisposableStore,
  ): void {
    const rendered = new Set<string>();
    store.add(
      session.onDidChange((change) => {
        for (const entry of entries) {
          const path = entry.file.path;

          if (!change.files.has(path) || rendered.has(path)) continue;
          const result = session.getFileResult(path);

          if (!result) continue;
          rendered.add(path);

          if (result.hidden !== undefined) view.hideFile(path, result.hidden);

          if (result.diff) view.fileCounts(path, reviewFileCounts(result.diff));
          view.fileLoaded(path, result.error);
        }

        if (session.error) view.loadingFailed(session.error);
      }),
    );
  }
}
