import { buildFileTree, flattenFileTree } from "./document/fileTree";
import { defaultCollapsed, foldIds, gapIds, hidingIds, nestedIds, sourceLines } from "./document/regions";
import { occurrences, type Match } from "./document/search";
import { rankFiles, type Pick } from "./document/pick";
import { placeholderRows, rowsForFile, type Layout, type RenderSpan, type SplitLineCell, type UnifiedLineCell, type ViewerRow } from "./document/rows";
import { lightMatches, type Lit } from "./viewport/cell";
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

interface ScopeHover {
  file: number;
  id: number;
  armed: boolean;
}

interface HeaderHover {
  file: number;
  header: true;
}

export type Hover = ScopeHover | HeaderHover;

/** A shifted letter arrives as its capital. */
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
  private pendingBracket: "]" | "[" | null = null;
  private readonly viewed = new Set<number>();
  private prompt: string | null = null;
  private search: { pattern: string; matches: Match[]; at: number; snapshot: Snapshot } | null = null;
  private promptCount: { pattern: string; snapshot: Snapshot; count: number } | undefined;
  private picker: { query: string; cursor: number } | null = null;
  private readonly openRows = new WeakMap<DiffFile, { layout: Layout; rows: ViewerRow[] }>();
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

  get chording(): boolean {
    return this.pendingZ || this.pendingBracket !== null;
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
    // Search lights whole lines before wrap and pan cut them, so its colours travel with the text.
    const lit = this.lit();
    const key = `${this.revision}:${layout}:${contentWidth}:${this.wrap}:${this.horizontal}:${lit ? JSON.stringify(lit) : ""}`;
    if (this.measured?.key !== key || this.measured.snapshot !== snapshot) {
      const rows = lit ? this.lightRows(this.documentRows(snapshot, layout), lit) : this.documentRows(snapshot, layout);
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
    this.setClosed(index, !this.isClosed(index, file));
    this.reshape();
  }

  private setClosed(index: number, closed: boolean) {
    const at = this.current();
    // Toggling the file being read moves to its header; the rows above it stay put.
    const header = at.geometry.rows.find((r) => r.row.key === `${index}:header`)!;
    if (header.top < at.top) this.position = { key: header.row.key, fileIndex: index, offset: 0, side: "right" };
    this.closed.set(index, closed);
  }

  /** Undefined when the file shows no changed lines. */
  isViewed(index: number): boolean | undefined {
    const diff = this.snapshot.files[index]?.diff;
    const markable = diff?.type === "text" && diff.stats.visible.added + diff.stats.visible.removed > 0;
    return markable ? this.viewed.has(index) : undefined;
  }

  viewedFiles(): { viewed: number; total: number } {
    let viewed = 0, total = 0;
    this.snapshot.files.forEach((_, index) => {
      const state = this.isViewed(index);
      if (state === undefined) return;
      total++;
      if (state) viewed++;
    });
    return { viewed, total };
  }

  toggleViewedFile(index: number) {
    const state = this.isViewed(index);
    if (state === undefined) return;
    if (state) this.viewed.delete(index);
    else this.viewed.add(index);
    this.setClosed(index, !state);
    this.reshape();
  }

  cancel() {
    if (this.prompt === null && !this.picker && !this.pendingZ && !this.pendingBracket) return;
    this.prompt = null;
    this.picker = null;
    this.pendingZ = false;
    this.pendingBracket = null;
    this.emit();
  }

  get picking(): boolean {
    return this.picker !== null;
  }

  pickerState(): { query: string; cursor: number; picks: Pick[]; total: number } | undefined {
    if (!this.picker) return undefined;
    const { inventory } = this.snapshot;
    const picks = rankFiles(inventory, this.fileOrder(this.snapshot), this.picker.query, (index) => this.isViewed(index) === true);
    return { query: this.picker.query, cursor: Math.min(this.picker.cursor, Math.max(0, picks.length - 1)), picks, total: inventory.length };
  }

  pickFile(index: number) {
    this.picker = null;
    const file = this.snapshot.files[index];
    if (file && this.isClosed(index, file)) {
      this.closed.set(index, false);
      this.revision++;
    }
    this.jump(index);
  }

  private typePicker(key: KeyPress) {
    const picker = this.picker!, name = key.key;
    if (name === "escape" || (key.ctrl && (name === "c" || name === "g"))) this.picker = null;
    else if (name === "return" || name === "enter") {
      const state = this.pickerState()!, pick = state.picks[state.cursor];
      if (pick) return this.pickFile(pick.fileIndex);
      this.picker = null;
    } else if (name === "up" || (key.ctrl && name === "p")) picker.cursor = Math.max(0, picker.cursor - 1);
    else if (name === "down" || (key.ctrl && name === "n")) picker.cursor += 1;
    else if (name === "backspace") this.picker = { query: picker.query.slice(0, -1), cursor: 0 };
    else if (!key.ctrl && !key.meta) {
      const text = name === "space" ? " " : name;
      if ([...text].length !== 1) return;
      this.picker = { query: picker.query + text, cursor: 0 };
    } else return;
    this.emit();
  }

  get prompting(): boolean {
    return this.prompt !== null;
  }

  searchState(): { prompt: string; count: number } | { pattern: string; at: number; total: number; files: number } | undefined {
    if (this.prompt !== null) {
      const snapshot = this.snapshot;
      if (this.promptCount?.pattern !== this.prompt || this.promptCount.snapshot !== snapshot)
        this.promptCount = { pattern: this.prompt, snapshot, count: this.findMatches(this.prompt).length };
      return { prompt: this.prompt, count: this.promptCount.count };
    }
    if (!this.search) return undefined;
    const { pattern, matches, at } = this.search;
    return { pattern, at: at + 1, total: matches.length, files: new Set(matches.map((match) => match.fileIndex)).size };
  }

  private lit(): { pattern: string; on?: Match } | undefined {
    const pattern = this.prompt ?? this.search?.pattern;
    if (!pattern) return undefined;
    return { pattern, on: this.prompt === null && this.search ? this.search.matches[this.search.at] : undefined };
  }

  private litFor(lit: { pattern: string; on?: Match }, fileIndex: number, key: string, side: "left" | "right"): Lit {
    const { on } = lit;
    return { pattern: lit.pattern, current: on && on.fileIndex === fileIndex && on.key === key && on.side === side ? on.nth : undefined };
  }

  headerLit(fileIndex: number): Lit | undefined {
    const lit = this.lit();
    return lit && this.litFor(lit, fileIndex, `${fileIndex}:header`, "right");
  }

  private lightRows(rows: ViewerRow[], lit: { pattern: string; on?: Match }): ViewerRow[] {
    const light = <Cell extends { spans: RenderSpan[] }>(cell: Cell | undefined, fileIndex: number, key: string, side: "left" | "right") => {
      if (!cell) return cell;
      const spans = lightMatches(cell.spans, this.litFor(lit, fileIndex, key, side), this.theme);
      return spans === cell.spans ? cell : { ...cell, spans };
    };
    return rows.map((row) => {
      if (row.cell) {
        const cell = light(row.cell, row.fileIndex, row.key, row.cell.newLineNumber === undefined ? "left" : "right");
        return cell === row.cell ? row : { ...row, cell };
      }
      const left = light(row.left, row.fileIndex, row.key, "left"), right = light(row.right, row.fileIndex, row.key, "right");
      return left === row.left && right === row.right ? row : { ...row, left, right };
    });
  }

  private allOpenRows(index: number, file: DiffFile, layout: Layout): ViewerRow[] {
    let cached = this.openRows.get(file);
    if (cached?.layout !== layout) {
      cached = { layout, rows: rowsForFile(file, index, layout, this.theme, new Set()) };
      this.openRows.set(file, cached);
    }
    return cached.rows;
  }

  private findMatches(pattern: string): Match[] {
    const { files, inventory } = this.snapshot;
    const layout = this.current().layout;
    const matches: Match[] = [];
    for (const index of this.fileOrder(this.snapshot)) {
      occurrences(filePath(inventory[index]!.file), pattern).forEach((_, nth) =>
        matches.push({ fileIndex: index, key: `${index}:header`, side: "right", nth }));
      const file = files[index];
      if (!file) continue;
      for (const row of this.allOpenRows(index, file, layout)) {
        const cells: ["left" | "right", SplitLineCell | UnifiedLineCell | undefined, number | undefined][] = row.cell
          ? [[row.cell.newLineNumber === undefined ? "left" : "right", row.cell, row.cell.newLineNumber ?? row.cell.oldLineNumber]]
          : [["left", row.left, row.left?.lineNumber], ["right", row.right, row.right?.lineNumber]];
        for (const [side, cell, line] of cells) {
          if (!cell || line === undefined) continue;
          occurrences(cell.spans.map((span) => span.text).join(""), pattern).forEach((_, nth) =>
            matches.push({ fileIndex: index, key: row.key, side, line, nth }));
        }
      }
    }
    return matches;
  }

  private placeOf(order: number[], layout: Layout, fileIndex: number, key: string, side: "left" | "right", line?: number): number {
    const file = this.snapshot.files[fileIndex];
    const rows = file ? this.allOpenRows(fileIndex, file, layout) : [];
    const lineOf = (row: ViewerRow) => side === "left" ? row.left?.lineNumber ?? row.cell?.oldLineNumber
      : row.right?.lineNumber ?? row.cell?.newLineNumber;
    let row = rows.findIndex((r) => r.key === key);
    // A row that only exists folded, such as a collapsed fold's own row, sits where its line does.
    if (row < 0 && line !== undefined) row = rows.findIndex((r) => (lineOf(r) ?? -1) >= line);
    // No file has ten million rows, so a file's place times that leaves room for all of its rows.
    return order.indexOf(fileIndex) * 1e7 + Math.max(0, row);
  }

  private commitSearch(pattern: string) {
    this.prompt = null;
    if (!pattern) return this.emit();
    const snapshot = this.snapshot, matches = this.findMatches(pattern);
    this.search = { pattern, matches, at: -1, snapshot };
    if (!matches.length) return this.emit();
    const at = this.current(), top = positionAt(at.geometry, at.top);
    const order = this.fileOrder(snapshot);
    const from = top ? this.placeOf(order, at.layout, top.fileIndex, top.key, top.side, top.line) : 0;
    const next = matches.findIndex((match) => this.placeOf(order, at.layout, match.fileIndex, match.key, match.side, match.line) >= from);
    this.search.at = next < 0 ? 0 : next;
    this.goTo(matches[this.search.at]!);
  }

  /** Also searches files that streamed in since the search. */
  private stepMatch(direction: 1 | -1) {
    const search = this.search;
    if (!search) return;
    if (search.snapshot !== this.snapshot) {
      const on = search.matches[search.at];
      search.matches = this.findMatches(search.pattern);
      search.snapshot = this.snapshot;
      search.at = on ? search.matches.findIndex((m) => m.fileIndex === on.fileIndex && m.key === on.key && m.side === on.side && m.nth === on.nth) : -1;
    }
    const total = search.matches.length;
    if (!total) return this.emit();
    search.at = (search.at + direction + total) % total;
    this.goTo(search.matches[search.at]!);
  }

  private goTo(match: Match) {
    const file = this.snapshot.files[match.fileIndex];
    if (file && match.line !== undefined) {
      if (this.isClosed(match.fileIndex, file)) this.closed.set(match.fileIndex, false);
      if (file.diff.type === "text") {
        const hiding = hidingIds(file.diff, match.side === "left" ? 0 : 1, match.line - 1, this.foldsOf(match.fileIndex, file.diff));
        if (hiding.length) this.setFolds(match.fileIndex, file.diff, hiding, false);
      }
    }
    this.position = { key: match.key, fileIndex: match.fileIndex, offset: 0, side: match.side, line: match.line };
    this.reshape();
  }

  private type(key: KeyPress) {
    const name = key.key, prompt = this.prompt!;
    if (name === "return" || name === "enter") return this.commitSearch(prompt);
    if (name === "escape" || (key.ctrl && (name === "c" || name === "g"))) this.prompt = null;
    else if (name === "backspace") this.prompt = prompt ? prompt.slice(0, -1) : null;
    else if (!key.ctrl && !key.meta) {
      const text = name === "space" ? " " : name;
      if ([...text].length !== 1) return;
      this.prompt = prompt + text;
    } else return;
    this.emit();
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
    if (JSON.stringify(hover) === JSON.stringify(this.hover)) return;
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
    if (this.picker) {
      this.typePicker(key);
      return true;
    }
    if (this.prompt !== null) {
      this.type(key);
      return true;
    }
    if (this.pendingZ) {
      this.pendingZ = false;
      if (!key.ctrl && !key.meta && name.length === 1 && "aocAOCRMjk".includes(name)) this.foldCommand(name);
      return true;
    }
    if (this.pendingBracket) {
      const bracket = this.pendingBracket;
      this.pendingBracket = null;
      if (!key.ctrl && !key.meta && name === "c") this.navigateHunk(bracket === "]" ? 1 : -1);
      return true;
    }
    // ⌘P, as in VS Code, where the terminal passes Cmd through; Ctrl-P everywhere else.
    if ((key.meta || key.ctrl) && name === "p") {
      this.picker = { query: "", cursor: 0 };
      this.emit();
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
      case "]": case "[": this.pendingBracket = name; break;
      case "s": this.toggleLayout(); break;
      case "w": this.toggleWrap(); break;
      case "c": this.toggleContext(); break;
      case "t": this.toggleTheme(); break;
      case "z": this.pendingZ = true; break;
      case "return": case "enter": this.toggleTopFile(); break;
      case "V": if (at.currentFile >= 0) this.toggleViewedFile(at.currentFile); break;
      case "/": this.prompt = ""; this.emit(); break;
      case "n": this.stepMatch(1); break;
      case "N": this.stepMatch(-1); break;
      default: return false;
    }
    return true;
  }
}
