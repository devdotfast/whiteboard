/**
 * The comparison on a phone: every file as a plain unified diff the browser scrolls, selects and
 * finds in natively. diffr's folds are the session's, as in the desktop view: a collapsed region
 * leaves a band (with its pseudocode, for a summary) or folds into its header line, and a line that
 * heads a fold carries its chevron. Every fold control is the full row or band, for a thumb.
 */
import { Emitter } from "vs/base/common/event.js";
import { Disposable, toDisposable } from "vs/base/common/lifecycle.js";
import { type IObservable, autorun } from "vs/base/common/observable.js";
import {
  FontStyle,
  TokenMetadata,
} from "vs/editor/common/encodedTokenAttributes.js";

import { showLineNumbers } from "./display.js";

import "./mobileDiff.css";
import type { ReviewDiffProgress, ReviewDiffProgressFile } from "./protocol.js";
import { ReviewViewedCheckbox } from "./review/browser/reviewTooltip.js";
import {
  type ReviewFileCounts,
  type StructuralSource,
  type StructuralSyntaxSpan,
  type StructuralTextDiff,
  binarySizeLabel,
  isBinaryCounts,
  structuralHighlights,
  utf16Column,
} from "./review/common/reviewStructuralDiff.js";
import {
  SYNTAX_SCOPES,
  type SyntaxRole,
  syntaxRole,
} from "./review/common/reviewSyntaxRoles.js";
import {
  type UnifiedBand,
  type UnifiedItem,
  type UnifiedLine,
  sourceLines,
  unifiedItems,
} from "./review/common/reviewUnifiedRows.js";
import type { ReviewFilesEditorEntry } from "./review/services/reviewFilesDiffView.js";
import type { StructuralDiffSession } from "./review/services/reviewStructuralDiffSession.js";
import { StandaloneServices } from "./standalone/browser/standaloneServices.js";
import { IStandaloneThemeService } from "./standalone/common/standaloneTheme.js";
import { element } from "./ui.js";

/** Rows per block the browser may skip laying out while it is off screen. */
const CHUNK = 120;

/** Characters of a line drawn, as the desktop editor stops rendering past them. */
const MAX_LINE = 10_000;

/** A file's body is built within this distance of the screen and released past the second. */
const BUILD_MARGIN = "150% 0px";

const RELEASE_MARGIN = "600% 0px";

/** Rows an undrawn file's placeholder is tall. */
const PLACEHOLDER_ROWS = 12;

const LOADING = "Loading diff…";

/** One find match, as find.ts counts: 1-based line and column. */
export interface MobileFindMatch {
  path: string;
  side: "original" | "modified";
  line: number;
  column: number;
  length: number;
}

interface FileView {
  readonly entry: ReviewFilesEditorEntry;
  readonly section: HTMLElement;
  readonly header: HTMLElement;
  readonly name: HTMLElement;
  readonly note: HTMLElement;
  readonly countsNode: HTMLElement;
  readonly viewed: ReviewViewedCheckbox;
  readonly body: HTMLElement;
  /** Why the file has no diff to show yet, or ever. */
  state: string | undefined;
  collapsed: boolean;
  /** The reader or a lens folded it; a hidden file's own fold waits until then. */
  collapseSet: boolean;
  hidden?: string;
  counts?: ReviewFileCounts;
  progress?: ReviewDiffProgressFile;
  viewedApplied?: string;
  /** Its body is drawn; otherwise a placeholder holds its last height. */
  built: boolean;
  near: boolean;
}

export class MobileDiffView extends Disposable {
  private readonly _onDidScroll = this._register(new Emitter<void>());
  /** The list scrolled or its topmost file changed. */
  readonly onDidScroll = this._onDidScroll.event;
  private readonly _onDidRequestFile = this._register(new Emitter<string>());
  /** A file still waiting came on screen. */
  readonly onDidRequestFile = this._onDidRequestFile.event;

  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly files = new Map<string, FileView>();
  private readonly bySection = new WeakMap<Element, FileView>();
  private order: FileView[] = [];
  private progress: ReviewDiffProgress | undefined;
  private readonly build: IntersectionObserver;
  private readonly release: IntersectionObserver;
  private readonly request: IntersectionObserver;
  private scrollFrame = 0;
  /** A selection when the press began: the tap ends it, and must not fold anything. */
  private pressedOverSelection = false;
  private find: { matches: MobileFindMatch[]; current: number } | undefined;
  private reveal: { cancel(): void } | undefined;

  constructor(
    container: HTMLElement,
    private readonly session: StructuralDiffSession,
    private readonly onToggleViewed: (path: string) => void,
    wordWrap: IObservable<boolean>,
  ) {
    super();
    this.root = container.appendChild(element("div", "mdiff"));
    this.root.tabIndex = -1;
    this.status = this.root.appendChild(element("div", "mdiff-status"));
    this.status.setAttribute("role", "status");
    this._register(toDisposable(() => this.root.remove()));

    this.build = new IntersectionObserver(
      (entries) => this.preserve(() => this.onBuild(entries)),
      { root: this.root, rootMargin: BUILD_MARGIN },
    );
    this.release = new IntersectionObserver(
      (entries) => this.onRelease(entries),
      { root: this.root, rootMargin: RELEASE_MARGIN },
    );
    this.request = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const file = this.bySection.get(entry.target);

          if (entry.isIntersecting && file?.state === LOADING)
            this._onDidRequestFile.fire(file.entry.file.path);
        }
      },
      { root: this.root },
    );
    this._register(
      toDisposable(() => {
        this.build.disconnect();
        this.release.disconnect();
        this.request.disconnect();
        this.reveal?.cancel();
        cancelAnimationFrame(this.scrollFrame);

        for (const file of this.files.values()) file.viewed.dispose();
        CSS.highlights?.delete("diffr-find");
        CSS.highlights?.delete("diffr-find-current");
      }),
    );

    this.root.addEventListener(
      "scroll",
      () => {
        if (this.scrollFrame) return;
        this.scrollFrame = requestAnimationFrame(() => {
          this.scrollFrame = 0;
          this._onDidScroll.fire();
        });
      },
      { passive: true },
    );
    this.root.addEventListener(
      "pointerdown",
      () => {
        this.pressedOverSelection = !(
          window.getSelection()?.isCollapsed ?? true
        );
        this.reveal?.cancel();
      },
      { passive: true },
    );
    this.root.addEventListener("click", (event) => this.onClick(event));
    this.root.addEventListener("keydown", (event) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target instanceof HTMLElement &&
        event.target.matches(".mdiff-band")
      ) {
        event.preventDefault();
        this.onClick(event);
      }
    });

    const resize = new ResizeObserver(() =>
      this.root.style.setProperty(
        "--mdiff-width",
        `${this.root.clientWidth}px`,
      ),
    );

    resize.observe(this.root);
    this._register(toDisposable(() => resize.disconnect()));

    this._register(
      autorun((reader) =>
        this.root.classList.toggle("is-wrapped", wordWrap.read(reader)),
      ),
    );
    this._register(
      autorun((reader) =>
        this.root.classList.toggle("no-numbers", !showLineNumbers.read(reader)),
      ),
    );

    const themes = StandaloneServices.get(IStandaloneThemeService);
    const paint = () => this.paintSyntax(themes);
    this._register(themes.onDidColorThemeChange(paint));
    paint();

    this._register(
      session.onDidChange((change) =>
        this.preserve(() => {
          for (const path of change.files) {
            const file = this.files.get(path);

            if (file?.built) this.renderBody(file);
          }
        }),
      ),
    );
  }

  /** The theme's colour for each of diffr's syntax roles, as CSS variables. */
  private paintSyntax(
    themes: ReturnType<typeof StandaloneServices.get<IStandaloneThemeService>>,
  ): void {
    const tokens = themes.getColorTheme().tokenTheme;
    const colors = tokens.getColorMap();

    for (const [role, scope] of Object.entries(SYNTAX_SCOPES)) {
      const metadata = tokens.match(0, scope);
      const color = colors[TokenMetadata.getForeground(metadata)];
      this.root.style.setProperty(`--mdiff-${role}`, color?.toString() ?? "");
      this.root.style.setProperty(
        `--mdiff-${role}-style`,
        TokenMetadata.getFontStyle(metadata) & FontStyle.Italic
          ? "italic"
          : "normal",
      );
    }
  }

  startLoading(entries: readonly ReviewFilesEditorEntry[]): void {
    for (const entry of entries) {
      if (this.files.has(entry.file.path)) continue;
      const file = this.createFile(entry);
      this.files.set(entry.file.path, file);
      this.bySection.set(file.section, file);
      this.order.push(file);
      this.root.append(file.section);
      this.build.observe(file.section);
      this.release.observe(file.section);
      this.request.observe(file.section);
    }

    this.showStatus();
  }

  private createFile(entry: ReviewFilesEditorEntry): FileView {
    const path = entry.file.path;
    const section = element("section", "mdiff-file");
    section.dataset.path = path;
    const header = section.appendChild(element("header", "mdiff-header"));
    header.setAttribute("role", "button");
    header.tabIndex = 0;
    const title = header.appendChild(element("span", "mdiff-header-title"));
    const at = path.lastIndexOf("/");
    const name = title.appendChild(element("span", "mdiff-header-path"));

    if (at >= 0)
      name.append(element("span", "mdiff-header-dir", path.slice(0, at + 1)));
    name.append(element("span", "mdiff-header-name", path.slice(at + 1)));

    if (entry.file.previousPath)
      name.title = `${entry.file.previousPath} → ${path}`;
    const note = title.appendChild(element("span", "mdiff-header-note"));

    const countsNode = header.appendChild(
      element("span", "mdiff-header-counts"),
    );

    const viewed = new ReviewViewedCheckbox(document, () =>
      this.onToggleViewed(path),
    );

    header.append(viewed.element);
    const body = section.appendChild(element("div", "mdiff-body"));

    const file: FileView = {
      entry,
      section,
      header,
      name,
      note,
      countsNode,
      viewed,
      body,
      state: LOADING,
      collapsed: false,
      collapseSet: false,
      built: false,
      near: false,
    };

    this.renderHeader(file);
    this.renderBody(file);

    return file;
  }

  fileLoaded(path: string, error?: string): void {
    const file = this.files.get(path);

    if (!file) return;
    file.state = error;
    this.preserve(() => {
      this.applyViewed(file);
      this.renderHeader(file);
      this.renderBody(file);
    });
    this.showStatus();
    this.applyFind();
  }

  loadingFailed(message: string): void {
    for (const file of this.files.values())
      if (file.state === LOADING)
        this.fileLoaded(file.entry.file.path, message);
    this.showStatus();
  }

  /** A file diffr hides by default (generated, vendored), and why. */
  hideFile(path: string, label: string): void {
    const file = this.files.get(path);

    if (!file) return;
    file.hidden = label;

    if (!file.collapseSet) file.collapsed = true;
    this.preserve(() => {
      this.renderHeader(file);
      this.renderBody(file);
    });
  }

  fileCounts(path: string, counts: ReviewFileCounts): void {
    const file = this.files.get(path);

    if (!file) return;
    file.counts = counts;
    this.renderHeader(file);
  }

  setFileCollapsed(path: string, collapsed: boolean): void {
    const file = this.files.get(path);

    if (!file) return;
    file.collapseSet = true;

    if (file.collapsed === collapsed) return;
    file.collapsed = collapsed;
    this.preserve(() => {
      this.renderHeader(file);
      this.renderBody(file);
    });
  }

  listOnly(paths: ReadonlySet<string> | undefined): void {
    for (const file of this.order)
      file.section.hidden = !!paths && !paths.has(file.entry.file.path);
  }

  setProgress(progress: ReviewDiffProgress): void {
    this.progress = progress;
    this.preserve(() => {
      for (const file of this.order) {
        file.progress = progress.files.find(
          (candidate) => candidate.path === file.entry.file.path,
        );
        this.applyViewed(file);
        this.renderHeader(file);
      }
    });
  }

  /** A file folds once viewed, and opens again once it is not, as the desktop view does. */
  private applyViewed(file: FileView): void {
    const state = file.progress?.state;

    if (!state || state === file.viewedApplied || file.state) return;
    const previous = file.viewedApplied;
    file.viewedApplied = state;

    const collapsed =
      state === "viewed"
        ? true
        : previous === "viewed" ||
            this.progress?.changedPaths?.includes(file.entry.file.path)
          ? false
          : undefined;

    if (collapsed === undefined || collapsed === file.collapsed) return;
    file.collapsed = collapsed;
    file.collapseSet = true;
    this.renderBody(file);
  }

  private renderHeader(file: FileView): void {
    const { entry } = file;
    const binary = !!entry.file.binary || isBinaryCounts(file.counts);
    const locked = binary || !!file.state;
    file.header.setAttribute(
      "aria-expanded",
      String(!file.collapsed && !locked),
    );
    file.header.classList.toggle("is-collapsed", file.collapsed || locked);
    file.header.setAttribute(
      "aria-label",
      `${file.collapsed ? "Expand" : "Collapse"} ${entry.file.path}`,
    );
    file.note.textContent =
      binary && isBinaryCounts(file.counts)
        ? `Binary file${binarySizeLabel(file.counts) ? ` · ${binarySizeLabel(file.counts)}` : ""}`
        : (file.hidden ?? (entry.file.status === "deleted" ? "Deleted" : ""));
    file.note.hidden = !file.note.textContent;
    const remaining = file.progress?.remaining;

    const counts =
      file.counts && !isBinaryCounts(file.counts) ? file.counts : undefined;

    const added = remaining?.additions ?? counts?.added;
    const removed = remaining?.deletions ?? counts?.removed;
    file.countsNode.replaceChildren();

    if (added)
      file.countsNode.append(element("span", "mdiff-added", `+${added}`));

    if (removed)
      file.countsNode.append(element("span", "mdiff-removed", `−${removed}`));
    file.viewed.update(file.progress?.state, entry.file.path, !file.progress);
    file.viewed.element.hidden = entry.file.status === "unchanged";
  }

  /** Draw a file's body if it is near the screen, else hold its place. */
  private renderBody(file: FileView): void {
    const diff = this.session.getTextDiff(file.entry.file.path);
    file.body.classList.remove("is-message");

    if (file.state || !diff || file.collapsed) {
      file.built = false;
      file.body.style.height = "";
      file.body.replaceChildren();

      const message =
        file.state ??
        (file.collapsed
          ? undefined
          : this.session.getFileResult(file.entry.file.path)?.error);

      if (message) {
        file.body.classList.add("is-message");
        file.body.textContent = message;
      }

      return;
    }

    if (!file.near) {
      // Off screen, a file keeps the height it was last drawn at, or a few rows' worth: diffr
      // folds most of a file away.
      file.body.style.height ||= `${PLACEHOLDER_ROWS * 22}px`;
      file.built = false;
      file.body.replaceChildren();

      return;
    }

    file.built = true;
    file.body.style.height = "";
    file.body.replaceChildren(this.renderDiff(file.entry.file.path, diff));
    this.applyFind();
  }

  private onBuild(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const file = this.bySection.get(entry.target);

      if (!file || file.near) continue;
      file.near = true;
      this.renderBody(file);
    }
  }

  private onRelease(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (entry.isIntersecting) continue;
      const file = this.bySection.get(entry.target);

      if (!file?.near) continue;
      file.near = false;

      if (!file.built) continue;
      file.body.style.height = `${file.body.offsetHeight}px`;
      file.built = false;
      file.body.replaceChildren();
    }
  }

  private renderDiff(path: string, diff: StructuralTextDiff): HTMLElement {
    const items = unifiedItems(diff, (id) =>
      this.session.isRegionCollapsed(path, id),
    );

    const text = {
      lhs: sourceLines(diff.lhs?.text),
      rhs: sourceLines(diff.rhs?.text),
    };

    const syntax = { lhs: syntaxByLine(diff.lhs), rhs: syntaxByLine(diff.rhs) };
    const changed = changedByLine(diff);
    const rows = element("div", "mdiff-rows");
    rows.style.setProperty(
      "--mdiff-digits",
      String(String(Math.max(text.lhs.length, text.rhs.length)).length),
    );
    let chunk: HTMLElement | undefined;
    let previous: UnifiedItem | undefined;
    items.forEach((item, index) => {
      if (index % CHUNK === 0) {
        chunk = rows.appendChild(element("div", "mdiff-chunk"));
        chunk.style.containIntrinsicBlockSize = `auto ${Math.min(CHUNK, items.length - index) * 20}px`;
      }

      const startsChange =
        item.kind === "line"
          ? item.change !== "context" &&
            (previous?.kind !== "line" || previous.change === "context")
          : item.change !== "unchanged";

      chunk!.append(
        item.kind === "band"
          ? this.renderBand(item, startsChange)
          : this.renderLine(item, text, syntax, changed, startsChange),
      );
      previous = item;
    });

    if (!items.length)
      rows.append(element("div", "mdiff-empty", "No changes to show"));

    return rows;
  }

  private renderLine(
    line: UnifiedLine,
    text: Record<"lhs" | "rhs", string[]>,
    syntax: Record<"lhs" | "rhs", Map<number, StructuralSyntaxSpan[]>>,
    changed: Record<"lhs" | "rhs", Map<number, [number, number][]>>,
    startsChange: boolean,
  ): HTMLElement {
    const row = element("div", `mdiff-row is-${line.change}`);

    if (line.tinted) row.classList.add("is-tinted");

    if (startsChange) row.classList.add("is-change-start");

    if (line.base !== undefined) row.dataset.base = String(line.base);

    if (line.head !== undefined) row.dataset.head = String(line.head);
    const number = line.side === "lhs" ? line.base! : line.head!;
    const gutter = row.appendChild(element("span", "mdiff-gutter"));

    const fold =
      line.fold ??
      (line.pill && { foldStateId: line.pill.foldStateId, collapsed: true });

    if (fold) {
      row.classList.add("has-fold");
      row.classList.toggle("is-folded", fold.collapsed);
      row.dataset.fold = String(fold.foldStateId);
      row.dataset.collapsed = String(fold.collapsed);
      const button = gutter.appendChild(element("button", "mdiff-chevron"));
      button.type = "button";
      button.setAttribute("aria-expanded", String(!fold.collapsed));
      button.setAttribute(
        "aria-label",
        `${fold.collapsed ? "Expand" : "Fold"} scope at line ${number + 1}`,
      );
    }

    gutter.append(element("span", "mdiff-lineno", String(number + 1)));
    const code = row.appendChild(element("span", "mdiff-code"));
    const source = text[line.side][number] ?? "";
    code.append(
      renderCode(
        source,
        syntax[line.side].get(number),
        line.tinted ? changed[line.side].get(number) : undefined,
      ),
    );

    if (line.pill) {
      const pill = code.appendChild(
        element("span", "mdiff-pill", `⋯ ${line.pill.label}`),
      );

      pill.setAttribute("aria-hidden", "true");

      if (line.pill.closer)
        code.append(element("span", "mdiff-closer", ` ${line.pill.closer}`));
    }

    return row;
  }

  private renderBand(band: UnifiedBand, startsChange: boolean): HTMLElement {
    const node = element("div", `mdiff-band kind-${band.change}`);

    if (startsChange) node.classList.add("is-change-start");
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.dataset.fold = String(band.foldStateId);
    node.style.setProperty("--mdiff-indent", String(band.indent));
    const summary = band.detail.length > 0;
    node.setAttribute(
      "aria-label",
      `Expand ${band.hidden} hidden line${band.hidden === 1 ? "" : "s"}${summary ? ", summarized" : `: ${band.title}`}`,
    );
    const title = node.appendChild(element("span", "mdiff-band-title"));
    title.append(element("span", "mdiff-band-chevron"));

    if (summary)
      title.append(element("span", "mdiff-band-caption", "Pseudocode"));
    title.append(element("span", "mdiff-band-label", band.title));

    if (summary) {
      const detail = node.appendChild(element("div", "mdiff-pseudocode"));

      for (const text of band.detail) {
        const line = detail.appendChild(
          element("div", "mdiff-pseudocode-line", text.trimStart() || " "),
        );

        line.style.setProperty(
          "--mdiff-indent",
          String(text.length - text.trimStart().length),
        );
      }
    }

    return node;
  }

  private onClick(event: Event): void {
    const target = event.target;

    if (!(target instanceof Element)) return;
    const overSelection = this.pressedOverSelection;
    this.pressedOverSelection = false;

    if (target.closest(".review-viewed-check")) return;
    const section = target.closest<HTMLElement>(".mdiff-file");
    const file = section && this.files.get(section.dataset.path!);

    if (!file) return;
    const path = file.entry.file.path;

    if (target.closest(".mdiff-header")) {
      if (file.state || file.entry.file.binary || isBinaryCounts(file.counts))
        return;
      this.setFileCollapsed(path, !file.collapsed);

      return;
    }

    // Ending a selection, or making one, is not a request to fold.
    if (overSelection || !(window.getSelection()?.isCollapsed ?? true)) return;

    const band = target.closest<HTMLElement>(".mdiff-band");

    if (band) {
      this.session.setRegionCollapsed(path, Number(band.dataset.fold), false);

      return;
    }

    const row = target.closest<HTMLElement>(".mdiff-row.has-fold");

    if (row)
      this.session.setRegionCollapsed(
        path,
        Number(row.dataset.fold),
        row.dataset.collapsed !== "true",
      );
  }

  /**
   * Keep the row at the top of the screen where it is while `change` redraws what is above or
   * around it. Browsers anchor scrolling on their own only when they redraw in place.
   */
  private preserve(change: () => void): void {
    const top = this.root.getBoundingClientRect().top;
    const anchor = this.anchor(top);
    change();

    if (!anchor) return;
    const node = anchor.find();

    if (!node) return;
    const delta = node.getBoundingClientRect().top - top - anchor.offset;

    if (Math.abs(delta) >= 1) this.root.scrollTop += delta;
  }

  private anchor(top: number) {
    const bounds = this.root.getBoundingClientRect();

    if (!bounds.height) return undefined;

    const hit = document
      .elementsFromPoint(bounds.left + bounds.width / 2, top + 1)
      .find(
        (node) =>
          this.root.contains(node) &&
          node.closest(".mdiff-row, .mdiff-band, .mdiff-file"),
      );

    const node = hit?.closest<HTMLElement>(
      ".mdiff-row, .mdiff-band, .mdiff-file",
    );

    const section = node?.closest<HTMLElement>(".mdiff-file");

    if (!node || !section) return undefined;
    const path = section.dataset.path!;

    const selector = node.classList.contains("mdiff-row")
      ? node.dataset.head !== undefined
        ? `.mdiff-row[data-head="${node.dataset.head}"]`
        : `.mdiff-row[data-base="${node.dataset.base}"]`
      : node.classList.contains("mdiff-band")
        ? `.mdiff-band[data-fold="${node.dataset.fold}"]`
        : undefined;

    const offset = node.getBoundingClientRect().top - top;

    return {
      offset,
      find: () => {
        const current = this.files.get(path)?.section;

        return (
          (selector && current?.querySelector<HTMLElement>(selector)) || current
        );
      },
    };
  }

  /** The topmost file on screen. */
  get activePath(): string | undefined {
    const top = this.root.scrollTop;
    const visible = this.order.filter((file) => !file.section.hidden);

    let low = 0,
      high = visible.length - 1,
      found: FileView | undefined;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const file = visible[middle]!;

      if (file.section.offsetTop <= top + 1) {
        found = file;
        low = middle + 1;
      } else high = middle - 1;
    }

    return (found ?? visible[0])?.entry.file.path;
  }

  /** Scroll a file's header to the top; `open` also unfolds it. */
  revealFile(path: string, open = false): void {
    const file = this.files.get(path);

    if (!file) return;

    if (open) this.setFileCollapsed(path, false);
    this.settle(() => {
      this.root.scrollTop = file.section.offsetTop;

      return true;
    });
  }

  /** Scroll one side's 1-based `line` a third of the way down, once its folds have opened. */
  revealLine(path: string, side: "original" | "modified", line: number): void {
    const file = this.files.get(path);

    if (!file) return;
    this.setFileCollapsed(path, false);
    file.near = true;

    if (!file.built) this.renderBody(file);
    this.settle(() => {
      const row = this.rowFor(file, side, line - 1);

      if (!row) return false;

      const delta =
        row.getBoundingClientRect().top -
        this.root.getBoundingClientRect().top -
        this.root.clientHeight / 3;

      if (Math.abs(delta) > 1) this.root.scrollTop += delta;
      row.classList.remove("is-revealed");
      void row.offsetWidth;
      row.classList.add("is-revealed");

      return true;
    });
  }

  private rowFor(file: FileView, side: "original" | "modified", line: number) {
    return side === "original"
      ? (file.body.querySelector<HTMLElement>(
          `.mdiff-row.is-removed[data-base="${line}"]`,
        ) ??
          file.body.querySelector<HTMLElement>(
            `.mdiff-row[data-base="${line}"]`,
          ))
      : file.body.querySelector<HTMLElement>(`.mdiff-row[data-head="${line}"]`);
  }

  /**
   * Run `apply` over the next frames, as folds open and files above settle, until it reports it
   * found its target, the reader touches the list, or a second passes.
   */
  private settle(apply: () => boolean): void {
    this.reveal?.cancel();

    let frame = 0,
      frames = 0,
      done = false;

    const step = () => {
      const found = apply();
      done ||= found;

      if (++frames < (done ? 4 : 60)) frame = requestAnimationFrame(step);
    };

    const reveal = {
      cancel: () => {
        cancelAnimationFrame(frame);

        if (this.reveal === reveal) this.reveal = undefined;
      },
    };

    this.reveal = reveal;
    frame = requestAnimationFrame(step);
  }

  /** The next or previous run of changes, drawing the files it passes. */
  goToChange(direction: "next" | "previous"): void {
    // Changes land on the reading line, a third of the way down, so they are measured from it.
    const line =
      this.root.getBoundingClientRect().top + this.root.clientHeight / 3;

    const active = this.order.findIndex(
      (file) => file.entry.file.path === this.activePath,
    );

    const sequence = (
      direction === "next"
        ? this.order.slice(Math.max(0, active))
        : this.order.slice(0, active + 1).reverse()
    ).filter((file) => !file.section.hidden && !file.collapsed);

    for (const file of sequence) {
      if (!file.built && !file.state) {
        file.near = true;
        this.preserve(() => this.renderBody(file));
      }

      const starts = [
        ...file.body.querySelectorAll<HTMLElement>(".is-change-start"),
      ];

      const target =
        direction === "next"
          ? starts.find((node) => node.getBoundingClientRect().top - line > 8)
          : starts
              .reverse()
              .find((node) => node.getBoundingClientRect().top - line < -8);

      if (target) {
        this.root.scrollTop += target.getBoundingClientRect().top - line;

        return;
      }
    }
  }

  scroll(to: number | "top" | "end"): void {
    this.reveal?.cancel();

    if (to === "top") this.root.scrollTop = 0;
    else if (to === "end") this.root.scrollTop = this.root.scrollHeight;
    else this.root.scrollTop += to;
  }

  focus(): void {
    this.root.focus({ preventScroll: true });
  }

  /** Mark find's matches in the files drawn, with the CSS Custom Highlight API where it exists. */
  showFindMatches(matches: MobileFindMatch[], current: number): void {
    this.find = matches.length ? { matches, current } : undefined;
    this.applyFind();
  }

  private applyFind(): void {
    const highlights = CSS.highlights;

    if (!highlights) return;
    const all: Range[] = [];
    const current: Range[] = [];
    const find = this.find;

    if (find) {
      find.matches.forEach((match, index) => {
        const file = this.files.get(match.path);

        if (!file?.built) return;
        const row = this.rowFor(file, match.side, match.line - 1);
        const code = row?.querySelector(".mdiff-code");
        const range = code && textRange(code, match.column - 1, match.length);

        if (!range) return;
        (index === find.current ? current : all).push(range);
      });
    }

    highlights.set("diffr-find", new Highlight(...all));
    highlights.set("diffr-find-current", new Highlight(...current));
  }

  private showStatus(): void {
    const states = this.order.map((file) => file.state);
    const loading = states.filter((state) => state === LOADING).length;
    this.status.hidden = !loading;
    this.status.textContent = loading
      ? `Diffing ${this.order.length - loading} of ${this.order.length} files…`
      : "";
  }

  // The desktop view's surface, which a phone has no use for: its file tree is a sheet
  // (mobileFiles.ts), and it has no editors.
  toggleFileTree(): void {}
  codeEditor(): undefined {
    return undefined;
  }
}

const syntaxCache = new WeakMap<
  StructuralSource,
  Map<number, StructuralSyntaxSpan[]>
>();

function syntaxByLine(source: StructuralSource | undefined) {
  if (!source) return new Map<number, StructuralSyntaxSpan[]>();
  let byLine = syntaxCache.get(source);

  if (!byLine) {
    byLine = new Map();

    for (const span of source.syntax ?? []) {
      const group = byLine.get(span.line);

      if (group) group.push(span);
      else byLine.set(span.line, [span]);
    }

    syntaxCache.set(source, byLine);
  }

  return byLine;
}

const changedCache = new WeakMap<
  StructuralTextDiff,
  Record<"lhs" | "rhs", Map<number, [number, number][]>>
>();

/** Each side's changed token spans by zero-based line, as zero-based UTF-16 ranges. */
function changedByLine(diff: StructuralTextDiff) {
  let result = changedCache.get(diff);

  if (!result) {
    const highlights = structuralHighlights(diff);

    const group = (
      spans: readonly {
        startLineNumber: number;
        startColumn: number;
        endColumn: number;
      }[],
    ) => {
      const byLine = new Map<number, [number, number][]>();

      for (const span of spans) {
        const line = span.startLineNumber - 1;
        const ranges = byLine.get(line) ?? [];
        ranges.push([span.startColumn - 1, span.endColumn - 1]);
        byLine.set(line, ranges);
      }

      return byLine;
    };

    result = {
      lhs: group(highlights.original),
      rhs: group(highlights.modified),
    };
    changedCache.set(diff, result);
  }

  return result;
}

/** A line's text, split where its syntax role or changed tint begins or ends. */
function renderCode(
  text: string,
  syntax: readonly StructuralSyntaxSpan[] | undefined,
  changed: readonly [number, number][] | undefined,
): DocumentFragment | Text {
  const shown = text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text;

  if (!syntax?.length && !changed?.length)
    return document.createTextNode(shown);
  const roles: [number, number, SyntaxRole][] = [];

  for (const span of syntax ?? []) {
    const role = syntaxRole(span.capture);

    if (role)
      roles.push([
        utf16Column(text, span.start_column) - 1,
        utf16Column(text, span.end_column) - 1,
        role,
      ]);
  }

  const cuts = new Set([0, shown.length]);

  for (const [start, end] of [...roles, ...(changed ?? [])]) {
    cuts.add(Math.min(start, shown.length));
    cuts.add(Math.min(end, shown.length));
  }

  const points = [...cuts].sort((a, b) => a - b);
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]!,
      end = points[index + 1]!;

    if (start === end) continue;
    const role = roles.find(([from, to]) => from <= start && end <= to)?.[2];
    const tinted = changed?.some(([from, to]) => from <= start && end <= to);
    const piece = shown.slice(start, end);

    if (!role && !tinted) {
      fragment.append(piece);
      continue;
    }

    const span = element("span", undefined, piece);

    if (role) span.className = `mdiff-${role}`;

    if (tinted) span.classList.add("mdiff-changed");
    fragment.append(span);
  }

  return fragment;
}

/** The DOM range over `length` UTF-16 units of `node`'s text, from `offset`. */
function textRange(
  node: Node,
  offset: number,
  length: number,
): Range | undefined {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const range = document.createRange();

  let seen = 0,
    started = false;

  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const size = text.textContent?.length ?? 0;

    if (!started && offset < seen + size) {
      range.setStart(text, offset - seen);
      started = true;
    }

    if (started && offset + length <= seen + size) {
      range.setEnd(text, offset + length - seen);

      return range;
    }

    seen += size;
  }

  return undefined;
}
