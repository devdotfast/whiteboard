/**
 * The desktop's file list beside the diff: the changed-files tree, under a line of what is left to
 * review. A phone lists files in a sheet instead (mobileFiles.ts).
 */
import { Emitter } from "vs/base/common/event.js";
import { Disposable } from "vs/base/common/lifecycle.js";
import { IHoverService } from "vs/platform/hover/browser/hover.js";
import type { IInstantiationService } from "vs/platform/instantiation/common/instantiation.js";

import type { ReviewDiffFileWire, ReviewDiffProgress } from "./protocol.js";

import "./review/browser/media/review.css";
import { ReviewChangedFilesTree } from "./review/browser/reviewChangedFilesTree.js";
import {
  REVIEW_COUNTS_PENDING_TOOLTIP,
  ReviewTooltip,
  reviewChangesTooltip,
} from "./review/browser/reviewTooltip.js";
import {
  type ReviewFileCounts,
  isBinaryCounts,
} from "./review/common/reviewStructuralDiff.js";
import { element } from "./ui.js";

const DEFAULT_WIDTH = 260;

const MIN_WIDTH = 160;

const MAX_WIDTH = 480;

export class FilesSidebar extends Disposable {
  readonly element = element("div", "dv-sidebar review-files-editor-tree");
  private readonly _onDidOpenFile = this._register(new Emitter<string>());
  /** The reader picked a file in the tree. */
  readonly onDidOpenFile = this._onDidOpenFile.event;
  private readonly summary = element("div", "review-files-editor-summary");
  private readonly summaryTooltip: ReviewTooltip;
  private readonly tree: ReviewChangedFilesTree;
  private files: readonly ReviewDiffFileWire[] = [];
  private listed: ReadonlySet<string> | undefined;
  private readonly counts = new Map<string, ReviewFileCounts>();
  private progress: ReviewDiffProgress | undefined;

  constructor(instantiation: IInstantiationService) {
    super();
    this.element.style.width = `${DEFAULT_WIDTH}px`;
    this.element.append(this.summary);
    this.summary.hidden = true;
    this.summaryTooltip = this._register(
      new ReviewTooltip(
        instantiation.invokeFunction((accessor) => accessor.get(IHoverService)),
        this.summary,
      ),
    );
    this.tree = this._register(
      instantiation.createInstance(ReviewChangedFilesTree, this.element),
    );
    this._register(
      this.tree.onDidOpenFile((file) => this._onDidOpenFile.fire(file.path)),
    );

    const sash = this.element.appendChild(element("div", "dv-sash"));
    sash.addEventListener("pointerdown", (down) => {
      const start = this.element.offsetWidth;
      sash.setPointerCapture(down.pointerId);

      const move = (event: PointerEvent) => {
        const width = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, start + event.clientX - down.clientX),
        );

        this.element.style.width = `${width}px`;
        this.layout();
      };

      sash.addEventListener("pointermove", move);
      sash.addEventListener(
        "lostpointercapture",
        () => sash.removeEventListener("pointermove", move),
        { once: true },
      );
    });

    const size = new ResizeObserver(() => this.layout());
    size.observe(this.element);
    this._register({ dispose: () => size.disconnect() });
  }

  get hidden(): boolean {
    return this.element.hidden === true;
  }

  set hidden(hidden: boolean) {
    this.element.hidden = hidden;

    if (!hidden) this.layout();
  }

  layout(): void {
    if (this.element.hidden) return;
    this.tree.layout(
      this.element.clientHeight -
        (this.summary.hidden ? 0 : this.summary.offsetHeight),
      this.element.clientWidth,
    );
  }

  setFiles(files: readonly ReviewDiffFileWire[]): void {
    this.files = files;
    this.list();
  }

  /** List only `paths`, as a lens does; `undefined` lists every file. */
  listOnly(paths: ReadonlySet<string> | undefined): void {
    this.listed = paths;
    this.list();
  }

  private list(): void {
    this.tree.setFiles(
      this.files.filter((file) => this.listed?.has(file.path) ?? true),
    );
    this.renderSummary();
  }

  setFileState(
    path: string,
    state: "loading" | "error" | undefined,
    message?: string,
  ): void {
    this.tree.setFileState(path, state, message);
  }

  setCounts(path: string, counts: ReviewFileCounts): void {
    this.counts.set(path, counts);
    this.tree.setCounts(path, counts);
    this.renderSummary();
  }

  setProgress(progress: ReviewDiffProgress): void {
    this.progress = progress;
    this.tree.setProgressFiles(progress.files);
    this.renderSummary();
  }

  /** Follow the file on top of the diff, unless the reader scrolled the tree away from it. */
  setActiveFile(path: string | undefined): void {
    this.tree.setActiveFile(path, "follow");
  }

  private renderSummary(): void {
    const paths = this.files
      .map((file) => file.path)
      .filter((path) => this.listed?.has(path) ?? true);

    const complete = paths.every((path) => this.counts.has(path));
    const total = { added: 0, removed: 0 };
    const remaining = { added: 0, removed: 0 };

    const progress = new Map(
      this.progress?.files.map((file) => [file.path, file]),
    );

    for (const path of paths) {
      const counts = this.counts.get(path);

      if (!counts || isBinaryCounts(counts)) continue;
      total.added += counts.added;
      total.removed += counts.removed;
      remaining.added +=
        progress.get(path)?.remaining.additions ?? counts.added;
      remaining.removed +=
        progress.get(path)?.remaining.deletions ?? counts.removed;
    }

    const height = this.summary.offsetHeight;
    this.summary.replaceChildren(
      element(
        "span",
        "review-files-editor-summary-files",
        this.listed
          ? `${paths.length} of ${this.files.length} files`
          : `${paths.length} files`,
      ),
    );

    if (complete) {
      const format = new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      });

      const size = total.added + total.removed;
      const viewed = Math.max(0, size - remaining.added - remaining.removed);
      const percent = size ? Math.round((viewed * 100) / size) : 100;

      const bar = element(
        "span",
        "review-files-editor-summary-progress",
        `${percent}%`,
      );

      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", "Changed lines viewed");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(percent));
      bar.setAttribute(
        "aria-valuetext",
        `${viewed} of ${size} changed lines viewed`,
      );
      bar.style.setProperty("--viewed-progress", `${percent}%`);
      this.summary.append(
        element("span", undefined, "Remaining"),
        element(
          "span",
          "review-files-editor-summary-added",
          `+${format.format(remaining.added).toLowerCase()}`,
        ),
        element(
          "span",
          "review-files-editor-summary-removed",
          `−${format.format(remaining.removed).toLowerCase()}`,
        ),
        bar,
      );
    } else this.summary.append(element("span", undefined, "Counting changes…"));

    this.summaryTooltip.content = complete
      ? reviewChangesTooltip(total.added, total.removed)
      : REVIEW_COUNTS_PENDING_TOOLTIP;
    this.summary.hidden = false;

    if (height !== this.summary.offsetHeight) this.layout();
  }
}
