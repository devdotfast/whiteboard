/**
 * One pull request or comparison on the page: its files listed from GitHub, each diffed by diffr in
 * a worker once its text is fetched, nearest the reader first, into Review Desktop's multi-diff view.
 * A file joins the list once diffed; the list keeps the reader's place as files arrive above.
 */
import { Emitter } from "vs/base/common/event.js";
import { Disposable, DisposableStore } from "vs/base/common/lifecycle.js";
import type { IObservable } from "vs/base/common/observable.js";
import { URI } from "vs/base/common/uri.js";
import { ICodeEditorService } from "vs/editor/browser/services/codeEditorService.js";
import type { IInstantiationService } from "vs/platform/instantiation/common/instantiation.js";

import { cache, cacheKey, cached } from "./cache.js";
import type {
  Classified,
  Diffed,
  Engine,
  FileEvent,
  FileRequest,
} from "./engine/engine.js";
import { foldIds, gapIds } from "./folds.js";
import {
  type Change,
  type ChangedFile,
  type Preview,
  type Target,
  fileText,
  loadChange,
  targetPath,
} from "./github.js";
import type { Lens } from "./lenses.js";
import type { ReviewDiffFileWire, StructuralLineCounts } from "./protocol.js";
import { orderReviewDiffFiles } from "./review/common/reviewChangedFilesModel.js";
import {
  type StructuralRegion,
  type StructuralTextDiff,
  regionLines,
  reviewFileCounts,
} from "./review/common/reviewStructuralDiff.js";
import type { ReviewDiffLayoutSetting } from "./review/services/reviewDiffLayout.js";
import {
  ReviewFilesDiffView,
  type ReviewFilesEditorEntry,
  ReviewFilesEditorInput,
} from "./review/services/reviewFilesDiffView.js";
import { createStructuralDiffEditors } from "./review/services/reviewStructuralDiff.js";
import { StructuralDiffSession } from "./review/services/reviewStructuralDiffSession.js";
import { structuralFoldCommand } from "./review/services/reviewStructuralFolds.js";
import { StructuralViewedState } from "./review/services/reviewStructuralViewed.js";
import { ScopeViewedControl } from "./review/services/reviewStructuralViewedControl.js";
import { ViewedProgress } from "./viewed.js";

/** Files fetched or diffed at once. The engine spreads them over its workers. */
const IN_FLIGHT = 12;

/** A lens closes a fold outside its ranges only from this many lines. */
const MIN_LENS_FOLD = 3;

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
  /** Of those, the files whose results this browser had kept (cache.ts). */
  cached: number;
  hidden: number;
  failed: number;
  /** Total diffr time, and the file that took longest. */
  diffMs: number;
  slowest?: { path: string; ms: number };
  /** Files whose summaries are being written, are in, or failed, and why. */
  summarizing: number;
  summarized: number;
  summaryErrors: { path: string; message: string }[];
  /** Agent plugins that threw, by file. */
  pluginErrors: { path: string; message: string }[];
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
    cached: 0,
    hidden: 0,
    failed: 0,
    diffMs: 0,
    summarizing: 0,
    summarized: 0,
    summaryErrors: [],
    pluginErrors: [],
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
  private lens: Lens | undefined;
  /** What the lens changed, to put back: folds by `path\0id`, and files by path. */
  private readonly lensFolds = new Map<string, boolean>();
  private readonly lensFiles = new Map<string, boolean>();

  constructor(
    private readonly container: HTMLElement,
    private readonly overflow: HTMLElement,
    readonly target: Target,
    private readonly engine: Engine,
    private readonly layout: ReviewDiffLayoutSetting,
    private readonly wordWrap: IObservable<boolean>,
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

  /** Files diffr diffed line by line, its structural diff having failed, and why. */
  get fallbacks(): { path: string; message: string }[] {
    return this.order.flatMap((path) => {
      const diff = this.session?.getFileResult(path)?.diff;
      const fallback = diff?.type === "text" ? diff.stats.fallback : undefined;

      return fallback ? [{ path, message: fallback.message }] : [];
    });
  }

  focus(): void {
    this.view?.focus();
  }

  /** Every changed file, in the list's order, and whether diffr has it yet. */
  get fileList(): {
    path: string;
    previousPath?: string;
    status: ChangedFile["status"];
    hidden?: string;
    diffed: boolean;
  }[] {
    return this.order.map((path) => {
      const file = this.files.get(path)!;

      return {
        path,
        previousPath: file.changed.previousPath,
        status: file.changed.status,
        hidden: file.classified?.hidden,
        diffed: file.state === "done",
      };
    });
  }

  /** Scroll to a file and show it, diffing it first if it is still waiting. */
  openFile(path: string): void {
    if (!this.files.has(path)) return;
    this.requested = [path, ...this.requested.filter((p) => p !== path)];
    this.pump();
    this.view?.revealFile(path, true);
  }

  /** Resolves once a file is diffed, or failed, asking for it first if it waits. */
  async whenDiffed(path: string): Promise<void> {
    const file = this.files.get(path);

    if (!file) throw new Error(`${path} is not a changed file`);

    if (file.state === "done") return;

    if (file.state === "waiting") {
      this.requested = [path, ...this.requested.filter((p) => p !== path)];
      this.pump();
    }

    await new Promise<void>((resolve, reject) => {
      const listener = this.onDidChange(() => {
        if (file.state !== "done" && !this._store.isDisposed) return;
        listener.dispose();

        if (this._store.isDisposed) reject(new Error("The comparison closed"));
        else resolve();
      });
    });
  }

  /** A diffed file's result: its diff, or why it has none. */
  fileResult(path: string) {
    return this.session?.getFileResult(path);
  }

  isRegionCollapsed(path: string, id: number): boolean | undefined {
    return this.session?.isRegionCollapsed(path, id);
  }

  setRegionCollapsed(path: string, id: number, collapsed: boolean): void {
    this.session?.setRegionCollapsed(path, id, collapsed);
  }

  get activeLens(): Lens | undefined {
    return this.lens;
  }

  /**
   * Show only a lens: its files open, every other file folded, and in a file it gives line ranges
   * for, the folds that hold none of them closed. `undefined` puts everything back as it was.
   */
  showLens(lens: Lens | undefined): void {
    const session = this.session;

    for (const [key, collapsed] of this.lensFolds) {
      const at = key.lastIndexOf("\0");
      session?.setRegionCollapsed(
        key.slice(0, at),
        Number(key.slice(at + 1)),
        collapsed,
      );
    }

    for (const [path, collapsed] of this.lensFiles)
      this.view?.setFileCollapsed(path, collapsed);
    this.lensFolds.clear();
    this.lensFiles.clear();
    this.lens = lens;

    if (lens) {
      for (const path of this.order) this.applyLens(path);
      const first = this.order.find((path) => this.lensMember(path));

      if (first) this.openFile(first);
    }

    this.changed.fire();
  }

  private lensMember(path: string) {
    const previous = this.files.get(path)?.changed.previousPath;

    return this.lens?.files.find(
      (file) => file.path === path || (!!previous && file.path === previous),
    );
  }

  /** Apply the lens to one file, once listed and again once diffed. */
  private applyLens(path: string): void {
    const file = this.files.get(path);

    if (!this.lens || !file) return;
    const member = this.lensMember(path);

    const hidden = !!(
      file.classified?.hidden ?? this.session?.getFileResult(path)?.hidden
    );

    if (!this.lensFiles.has(path)) this.lensFiles.set(path, hidden);
    this.view?.setFileCollapsed(path, !member);
    const session = this.session;
    const diff = session?.getTextDiff(path);

    if (!member?.ranges?.length || !session || !diff) return;
    const foldable = new Set(foldIds(diff));
    // A fold state is shared by both sides: it opens if either side's region holds a range.
    const open = new Map<number, boolean>();

    for (const [name, source] of [
      ["base", diff.lhs],
      ["head", diff.rhs],
    ] as const) {
      const ranges = member.ranges.filter((range) => range.side === name);

      const visit = (region: StructuralRegion) => {
        const { start, end } = regionLines(region);

        // Ranges count from 1 and include their last line; regions count from 0 and exclude it.
        const holds = ranges.some(
          (range) =>
            range.from - 1 < Math.max(end, start + 1) && range.to > start,
        );

        // Folds outside the ranges close; anything inside opens, a context gap included. Lines
        // between folds, and folds too short to save a row, stay as they are.
        if (
          foldable.has(region.fold_state_id) &&
          (holds || (region.kind === "fold" && end - start >= MIN_LENS_FOLD))
        )
          open.set(
            region.fold_state_id,
            (open.get(region.fold_state_id) ?? false) || holds,
          );

        if (holds && region.kind === "fold") region.children.forEach(visit);
      };

      if (source?.root.kind === "fold") source.root.children.forEach(visit);
    }

    for (const [id, opened] of open) {
      const key = `${path}\0${id}`;

      if (!this.lensFolds.has(key))
        this.lensFolds.set(key, session.isRegionCollapsed(path, id) ?? false);
      session.setRegionCollapsed(path, id, !opened);
    }
  }

  /** Each diffed file's text, by side, for searching. */
  texts(): { path: string; original?: string; modified?: string }[] {
    return this.order.flatMap((path) => {
      const diff = this.session?.getTextDiff(path);

      return diff
        ? [{ path, original: diff.lhs?.text, modified: diff.rhs?.text }]
        : [];
    });
  }

  /** Whether a 0-based base line of a diffed file was removed or changed. */
  removedLines(path: string): (line: number) => boolean {
    const ranges =
      this.session?.getTextDiff(path)?.structural_changes.base ?? [];

    return (line) => ranges.some(([start, end]) => line >= start && line < end);
  }

  /** Open every fold over one side's `line` (1-based), then scroll to it. */
  revealLine(path: string, side: "original" | "modified", line: number): void {
    const session = this.session;

    const source =
      session?.getTextDiff(path)?.[side === "original" ? "lhs" : "rhs"];

    if (!session || !source) return;

    const open = (region: StructuralRegion) => {
      const { start, end } = regionLines(region);

      if (line - 1 < start || line - 1 >= Math.max(end, start + 1)) return;

      if (session.isRegionCollapsed(path, region.fold_state_id))
        session.setRegionCollapsed(path, region.fold_state_id, false);

      if (region.kind === "fold") region.children.forEach(open);
    };

    open(source.root);
    this.view?.revealLine(path, side, line);
  }

  /** The editor showing one side of a file, while it is on screen. */
  codeEditor(path: string, side: "original" | "modified") {
    return this.view?.codeEditor(path, side);
  }

  goToChange(direction: "next" | "previous"): void {
    this.view?.goToChange(direction);
  }

  scroll(to: number | "top" | "end"): void {
    this.view?.scroll(to);
  }

  toggleFileTree(): void {
    this.view?.toggleFileTree();
  }

  /** A fold command at the caret of the focused diff editor (`StructuralFoldControls.command`). */
  foldCommand(command: string): void {
    const editor = this.instantiation
      .invokeFunction((accessor) => accessor.get(ICodeEditorService))
      .getFocusedCodeEditor();

    if (editor) structuralFoldCommand(editor, command);
  }

  /** Folds or unfolds everything diffr can fold, in every file. */
  foldAll(collapsed: boolean): void {
    this.setFolds(foldIds, collapsed);
  }

  /** Shows every context gap, or hides them all again once any is shown. */
  toggleContextGaps(): void {
    const session = this.session;

    if (!session) return;

    const shown = this.order.some((path) => {
      const diff = session.getTextDiff(path);

      return (
        !!diff &&
        gapIds(diff).some((id) => session.isRegionCollapsed(path, id) === false)
      );
    });

    this.setFolds(gapIds, shown);
  }

  private setFolds(
    ids: (diff: StructuralTextDiff) => number[],
    collapsed: boolean,
  ): void {
    const session = this.session;

    if (!session) return;

    for (const path of this.order) {
      const diff = session.getTextDiff(path);

      if (diff)
        for (const id of ids(diff))
          session.setRegionCollapsed(path, id, collapsed);
    }
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

    const viewedState = store.add(
      new StructuralViewedState(
        session,
        entries,
        () => viewed.progress,
        viewed.onDidChange,
        (ranges, isViewed) => viewed.setViewed(ranges, isViewed),
        (editor, onToggle) => new ScopeViewedControl(editor, onToggle),
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
        this.wordWrap,
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

  /** Names a file's result in the cache (cache.ts): the commits, the file, and the engine's build and configuration. */
  private async cacheKey(
    file: File,
    kind: "diff" | "summary",
  ): Promise<string> {
    const { changed } = file;

    return cacheKey([
      await this.engine.fingerprint,
      targetPath(this.target),
      this.change!.base,
      this.change!.head,
      changed.status,
      changed.previousPath,
      changed.path,
      kind,
    ]);
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
      const key = await this.cacheKey(file, "diff");
      const hit = await cached<Omit<Diffed, "ms">>(key);

      if (this._store.isDisposed) return;

      const text =
        hit?.event.diff?.type === "text"
          ? { lhs: hit.event.diff.lhs?.text, rhs: hit.event.diff.rhs?.text }
          : undefined;

      const [lhs, rhs] = hit
        ? [text?.lhs, text?.rhs]
        : await Promise.all([
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

      const diffed = hit
        ? { ...hit, ms: 0 }
        : await this.engine.diff(this.request(file, { lhs, rhs }));

      if (this._store.isDisposed) return;
      this.work.diffing--;
      this.work.diffMs += diffed.ms;

      if (hit) this.work.cached++;
      else if (diffed.event.diff)
        void cache(key, {
          classified: diffed.classified,
          event: diffed.event,
          pluginErrors: diffed.pluginErrors,
        } satisfies Omit<Diffed, "ms">);

      if (!hit && (!this.work.slowest || diffed.ms > this.work.slowest.ms))
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

        if (
          !diffed.classified.hidden &&
          event.diff.type === "text" &&
          this.engine.summarizes
        )
          void this.summarize(file, { lhs, rhs });

        // diffr folds a hidden file's whole text behind its reason; the header already folds the
        // file, so showing it shows the text instead of a second fold to open.
        if (diffed.classified.hidden && event.diff.type === "text")
          for (const side of [event.diff.lhs, event.diff.rhs])
            if (side?.root.visibility?.collapsed)
              session.setRegionCollapsed(
                changed.path,
                side.root.fold_state_id,
                false,
              );

        if (diffed.pluginErrors.length)
          this.work.pluginErrors.push(
            ...diffed.pluginErrors.map((message) => ({
              path: changed.path,
              message,
            })),
          );
        this.applyLens(changed.path);
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

  /**
   * Shown first without them, a file's summaries arrive from a second pass that waits on the
   * model, and relabel its folds in place.
   */
  private async summarize(
    file: File,
    text: { lhs?: string; rhs?: string },
  ): Promise<void> {
    const path = file.changed.path;
    this.work.summarizing++;
    this.changed.fire();

    try {
      const key = await this.cacheKey(file, "summary");
      const hit = await cached<FileEvent>(key);

      const event =
        hit ?? (await this.engine.diff(this.request(file, text), true)).event;

      if (this._store.isDisposed) return;

      if (event.diff?.type === "text") {
        this.session?.updateFileDiff(path, event.diff);
        this.work.summarized++;

        if (!hit) void cache(key, event);
      } else if (event.error)
        this.work.summaryErrors.push({ path, message: event.error.message });
    } catch (error) {
      if (this._store.isDisposed) return;
      this.work.summaryErrors.push({
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    this.work.summarizing--;
    this.changed.fire();
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
