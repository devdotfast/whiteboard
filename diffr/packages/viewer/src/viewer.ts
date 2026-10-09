import { buildFileTree, flattenFileTree } from "./document/fileTree";
import { defaultCollapsed, foldIds, gapIds, nestedIds, sourceLines } from "./document/regions";
import { placeholderRows, rowsForFile, type Layout, type ViewerRow } from "./document/rows";
import type { DiffStore, Snapshot } from "./protocol/store";
import { filePath, fileVisibility, type DiffFile, type TextDiff } from "./protocol/wire";
import { measureRows, positionAt, positionTop, rowFold, visibleRows, type Geometry, type MeasuredRow, type ViewPosition } from "./viewport/geometry";
import type { Palette } from "./theme/palette";
import { dark, light } from "./theme/themes";

/** Excludes the frontend's scrollbar and sidebar. */
export interface Size {
  columns: number;
  rows: number;
}

/** `armed`: a click would fold or open the scope. */
export interface Hover {
  file: number;
  id: number;
  armed: boolean;
}

/** A key as frontends report it; a shifted letter arrives as its capital. */
export interface KeyPress {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

interface Laid {
  size: Size;
  snapshot: Snapshot;
  theme: Palette;
  layout: Layout;
  wrap: boolean;
  horizontal: number;
  hover: Hover | null;
  rows: ViewerRow[];
  geometry: Geometry;
  /** First visible visual row. */
  top: number;
  maxScroll: number;
  viewport: MeasuredRow[];
  currentFile: number;
  sticky: boolean;
  thumb: { top: number; height: number };
}

export class Viewer {
  private mode: Layout | "auto" = "auto";
  private wrap = false;
  private position: ViewPosition | null = null;
  private horizontal = 0;
  private hover: Hover | null = null;
  private readonly closed = new Map<number, boolean>();
  private readonly collapsed = new Map<number, ReadonlySet<number>>();
  private pendingZ = false;
  private readonly rowCache = new WeakMap<DiffFile, { key: string; rows: ViewerRow[] }>();
  /** Bumped when rows change; keys the geometry cache. */
  private revision = 0;
  private measured: { key: string; snapshot: Snapshot; rows: ViewerRow[]; geometry: Geometry } | undefined;
  private size: Size | undefined;
  private readonly listeners = new Set<() => void>();
  /** Bumped by every change, for `useSyncExternalStore`. */
  private version = 0;

  /** `splitColumns`: the narrowest diff column `auto` lays out split. */
  constructor(private readonly store: DiffStore, private theme: Palette, private readonly splitColumns: number) {
    store.subscribe(() => this.emit());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  private reshape() {
    this.revision++;
    this.emit();
  }

  private get snapshot(): Snapshot {
    return this.store.getSnapshot();
  }

  /** A `z` was pressed: the next key names a fold command. */
  get chording(): boolean {
    return this.pendingZ;
  }

  isClosed(index: number, file: DiffFile) {
    return this.closed.get(index) ?? fileVisibility(file).collapsed;
  }

  private foldsOf(index: number, diff: TextDiff): ReadonlySet<number> {
    return this.collapsed.get(index) ?? defaultCollapsed(diff);
  }

  private fileOrder(snapshot: Snapshot) {
    return flattenFileTree(buildFileTree(snapshot.inventory), new Set()).flatMap(({ node }) =>
      node.fileIndex === undefined ? [] : [node.fileIndex]);
  }

  private documentRows(snapshot: Snapshot, layout: Layout): ViewerRow[] {
    const { inventory, files, failures } = snapshot;
    const perFile = this.fileOrder(snapshot).map((index): ViewerRow[] => {
      const file = files[index];
      if (!file) {
        const failure = failures[index];
        const status = failure ?? (snapshot.complete ? "File did not load" : "Computing diff…");
        return [{ key: `${index}:header`, fileIndex: index, label: filePath(inventory[index]!.file) },
          ...["", status, "", ""].map((label, line) => ({ key: `${index}:pending:${line}`, fileIndex: index,
            label, pending: line === 1 && !failure && !snapshot.complete }))];
      }
      const folds = file.diff.type === "text" ? this.foldsOf(index, file.diff) : new Set<number>();
      const key = `${index}:${layout}:${this.theme.name}:${[...folds].sort((a, b) => a - b).join(",")}`;
      let cached = this.rowCache.get(file);
      if (cached?.key !== key) {
        cached = { key, rows: rowsForFile(file, index, layout, this.theme, folds) };
        this.rowCache.set(file, cached);
      }
      if (!this.isClosed(index, file)) return cached.rows;
      return fileVisibility(file).collapsed
        ? [cached.rows[0]!, ...placeholderRows(index, fileVisibility(file).label)]
        : cached.rows.slice(0, 1);
    });
    // A blank row closes an open file before the next header. It belongs to the file it closes,
    // so the sticky header doesn't repeat the header just below it.
    const all: ViewerRow[] = [];
    for (const fileRows of perFile) {
      const last = all.at(-1);
      if (last && !last.key.endsWith(":header") && last.label !== "")
        all.push({ key: `${last.fileIndex}:end`, fileIndex: last.fileIndex, label: "" });
      all.push(...fileRows);
    }
    for (const [i, error] of snapshot.errors.entries())
      all.push({ key: `error:${i}`, fileIndex: -1, label: error });
    return all;
  }

  lay(size: Size): Laid {
    this.size = size;
    const snapshot = this.snapshot;
    const contentWidth = size.columns, viewportHeight = size.rows;
    const layout = this.mode === "auto" ? (contentWidth >= this.splitColumns ? "split" : "unified") : this.mode;
    const key = `${this.revision}:${layout}:${contentWidth}:${this.wrap}:${this.horizontal}`;
    if (this.measured?.key !== key || this.measured.snapshot !== snapshot) {
      const rows = this.documentRows(snapshot, layout);
      const maxLine = Math.max(1, ...snapshot.files.flatMap((file) => file?.diff.type === "text"
        ? [file.diff.lhs, file.diff.rhs].map((source) => source ? sourceLines(source.text).length : 0) : []));
      this.measured = { key, snapshot, rows, geometry: measureRows(rows, contentWidth, this.wrap, this.horizontal, maxLine) };
    }
    const { rows, geometry } = this.measured;
    const lastFileTop = geometry.rows.findLast((r) => r.row.key.endsWith(":header"))?.top ?? 0;
    // One past the end, since the sticky file header takes the viewport's first row.
    const maxScroll = Math.max(lastFileTop, geometry.height - viewportHeight + 1);
    const top = Math.min(positionTop(geometry, this.position), maxScroll);
    const viewport = visibleRows(geometry, top, viewportHeight);
    const currentFile = viewport[0]?.row.fileIndex ?? 0;
    const sticky = !!viewport.length && !viewport[0]!.row.key.endsWith(":header");
    const thumbHeight = Math.max(1, Math.floor((viewportHeight * viewportHeight) / Math.max(viewportHeight, geometry.height)));
    const thumbTop = maxScroll ? Math.round((top / maxScroll) * (viewportHeight - thumbHeight)) : 0;
    return { size, snapshot, theme: this.theme, layout, wrap: this.wrap, horizontal: this.horizontal, hover: this.hover,
      rows, geometry, top, maxScroll, viewport, currentFile, sticky, thumb: { top: thumbTop, height: thumbHeight } };
  }

  private current(): Laid {
    if (!this.size) throw new Error("The viewer has not been laid out yet");
    return this.lay(this.size);
  }

  scrollTo(value: number) {
    const at = this.current();
    this.position = positionAt(at.geometry, Math.max(0, Math.min(at.maxScroll, value)));
    this.emit();
  }

  /** Relative to the latest position, so key repeats within one frame add up. */
  move(amount: number) {
    this.scrollTo(this.current().top + amount);
  }

  scrub(row: number) {
    const at = this.current();
    this.scrollTo(Math.round(Math.max(0, Math.min(1, row / Math.max(1, at.size.rows - 1))) * at.maxScroll));
  }

  jump(index: number) {
    const row = this.current().geometry.rows.find((r) => r.row.fileIndex === index);
    if (!row) throw new Error(`File ${index} has no rows`);
    this.scrollTo(row.top);
  }

  toggleFile(index: number) {
    const file = this.snapshot.files[index];
    if (!file) return;
    const at = this.current();
    // Toggling the file being read moves to its header; the rows above it stay put.
    const header = at.geometry.rows.find((r) => r.row.key === `${index}:header`)!;
    if (header.top < at.top) this.position = { key: header.row.key, fileIndex: index, offset: 0, side: "right" };
    this.closed.set(index, !this.isClosed(index, file));
    this.reshape();
  }

  /** "toggle" reads the first id's state, so quick repeated clicks alternate. */
  private setFolds(fileIndex: number, diff: TextDiff, ids: number[], collapse: boolean | "toggle") {
    const next = new Set(this.foldsOf(fileIndex, diff));
    const close = collapse === "toggle" ? !next.has(ids[0]!) : collapse;
    for (const id of ids) if (close) next.add(id); else next.delete(id);
    this.collapsed.set(fileIndex, next);
  }

  /** Recursive commands (Alt-click, zC, zO, zA) include every fold nested inside. */
  setFold(fileIndex: number, id: number, collapse: boolean | "toggle", recursive: boolean) {
    const diff = this.snapshot.files[fileIndex]?.diff;
    if (diff?.type !== "text") throw new Error(`File ${fileIndex} has no folds`);
    this.setFolds(fileIndex, diff, recursive ? [id, ...nestedIds(diff, id)] : [id], collapse);
    this.reshape();
  }

  private textDiffs() {
    return this.snapshot.files.flatMap((file, index) => file?.diff.type === "text" ? [{ index, diff: file.diff }] : []);
  }

  toggleContext() {
    const textDiffs = this.textDiffs();
    const opened = textDiffs.some(({ index, diff }) => gapIds(diff).some((id) => !this.foldsOf(index, diff).has(id)));
    textDiffs.forEach(({ index, diff }) => this.setFolds(index, diff, gapIds(diff), opened));
    this.reshape();
  }

  foldAll(collapse: boolean) {
    this.textDiffs().forEach(({ index, diff }) => this.setFolds(index, diff, foldIds(diff), collapse));
    this.reshape();
  }

  private navigate(direction: number, matches: (row: ViewerRow) => boolean) {
    const at = this.current();
    const headers = at.geometry.rows.filter((r) => matches(r.row));
    const target = direction > 0 ? headers.find((r) => r.top > at.top) : headers.findLast((r) => r.top < at.top);
    if (target) this.scrollTo(target.top);
  }

  navigateHunk(direction: number) {
    this.navigate(direction, (row) => !!row.hunkStart);
  }

  private navigateFold(direction: number) {
    this.navigate(direction, (row) => !!rowFold(row));
  }

  private foldCommand(command: string) {
    if (command === "R") return this.foldAll(false);
    if (command === "M") return this.foldAll(true);
    if (command === "j") return this.navigateFold(1);
    if (command === "k") return this.navigateFold(-1);
    const at = this.current();
    const current = visibleRows(at.geometry, at.top, 1)[0]?.row;
    const fold = current && rowFold(current);
    if (!current || !fold) return;
    const recursive = command === command.toUpperCase();
    const letter = command.toLowerCase();
    if (letter === "a") this.setFold(current.fileIndex, fold.id, "toggle", recursive);
    else if (letter === "o") this.setFold(current.fileIndex, fold.id, false, recursive);
    else if (letter === "c") this.setFold(current.fileIndex, fold.id, true, recursive);
  }

  toggleLayout() {
    this.mode = this.current().layout === "split" ? "unified" : "split";
    this.reshape();
  }

  toggleWrap() {
    this.wrap = !this.wrap;
    this.emit();
  }

  setTheme(theme: Palette) {
    this.theme = theme;
    this.reshape();
  }

  /** `t` swaps between the two bundled defaults; a configured theme is left by the first press. */
  private toggleTheme() {
    this.setTheme(this.theme.isLight ? dark : light);
  }

  pan(columns: number) {
    this.horizontal = Math.max(0, this.horizontal + columns);
    this.emit();
  }

  setHover(hover: Hover | null) {
    if (hover?.file === this.hover?.file && hover?.id === this.hover?.id && hover?.armed === this.hover?.armed) return;
    this.hover = hover;
    this.emit();
  }

  private toggleTopFile() {
    const at = this.current();
    const current = visibleRows(at.geometry, at.top, 1)[0];
    if (current && current.row.fileIndex >= 0) this.toggleFile(current.row.fileIndex);
  }

  /** Returns false for keys the frontend handles. */
  press(key: KeyPress): boolean {
    const at = this.current();
    const page = at.size.rows, half = Math.max(1, Math.floor(at.size.rows / 2));
    const name = key.key;
    if (this.pendingZ) {
      this.pendingZ = false;
      if (!key.ctrl && !key.meta && name.length === 1 && "aocAOCRMjk".includes(name)) this.foldCommand(name);
      return true;
    }
    if (key.meta) return false;
    if (key.ctrl) {
      if (name === "d") this.move(half);
      else if (name === "u") this.move(-half);
      else if (name === "f") this.move(page);
      else if (name === "b") this.move(-page);
      else return false;
      return true;
    }
    switch (name) {
      case "d": this.move(half); break;
      case "u": this.move(-half); break;
      case " ": case "space": this.move(key.shift ? -page : page); break;
      case "pagedown": case "f": this.move(page); break;
      case "pageup": case "b": this.move(-page); break;
      case "down": case "j": this.move(1); break;
      case "up": case "k": this.move(-1); break;
      case "g": case "home": this.scrollTo(0); break;
      case "G": case "end": this.scrollTo(at.maxScroll); break;
      case "right": case "l": this.pan(key.shift ? 16 : 4); break;
      case "L": this.pan(16); break;
      case "left": case "h": this.pan(key.shift ? -16 : -4); break;
      case "H": this.pan(-16); break;
      case "]": this.navigateHunk(1); break;
      case "[": this.navigateHunk(-1); break;
      case "s": this.toggleLayout(); break;
      case "w": this.toggleWrap(); break;
      case "c": this.toggleContext(); break;
      case "t": this.toggleTheme(); break;
      case "z": this.pendingZ = true; break;
      case "return": case "enter": this.toggleTopFile(); break;
      default: return false;
    }
    return true;
  }
}
