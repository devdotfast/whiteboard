import { add, blockBar, comparisonLabel, zero } from "@diffr/viewer/document/counts";
import { buildFileTree, flattenFileTree, lineCounts, parentDirectories } from "@diffr/viewer/document/fileTree";
import { filePath } from "@diffr/viewer/protocol/wire";
import { sanitizeTerminalLine } from "@diffr/viewer/terminal/sanitize";
import { measureTextWidth } from "@diffr/viewer/terminal/text";
import type { DiffStore } from "@diffr/viewer/protocol/store";
import type { Palette } from "@diffr/viewer/theme/palette";
import { Viewer, type Hover, type KeyPress, type Size } from "@diffr/viewer/viewer";
import { litRuns, viewedBox, viewedHint } from "@diffr/viewer/viewport/cell";
import { pickerLines } from "@diffr/viewer/viewport/picker";
import { agentReference, copySelection, selectionBounds, type SourceSelection } from "@diffr/viewer/document/selection";
import { Colors, fit, LineBuilder, paintCell } from "./paint";
import type { Action, Frame, Input, Line } from "./protocol";

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** The key list `?` shows in place of the diff: keys, then what they do. */
const KEYS: [string, string][] = [
  ["j k · d u · space b", "scroll a line, half a page, a page"],
  ["g G", "first file, last line"],
  ["h l · H L", "pan sideways, faster"],
  ["[ ]", "previous, next change"],
  ["za zo zc · zA zO zC", "toggle, open, close the top fold; deep"],
  ["zM zR · zj zk", "fold all, unfold all; next, previous fold"],
  ["c", "show or hide unchanged context"],
  ["/ · n N", "search; next, previous match"],
  ["ctrl-p", "go to a changed file"],
  ["\\ · ⌘B · ☰ files", "the file tree"],
  ["V · a header's box", "mark a file viewed"],
  ["drag · y · Y", "select lines; copy them; copy them for an agent"],
  ["s · w · t", "split or unified; wrap; theme"],
  ["?", "this list"],
  ["q", "close the pane"],
];
/** Pinned to the status line's right end, so cut hints never cut the way to the list. */
const KEYS_BUTTON = " ? keys ";

/** What an input asks of the hooks module beyond a redraw. */
export interface Outcome {
  close?: true;
  /** Text for the clipboard, and what it is, for the message saying how the copy went. */
  copy?: { text: string; what: string };
}

/** Split only with about 80 code columns a side. */
const SPLIT_COLUMNS = 180;
/** Below this width the file tree starts hidden. */
const TREE_MIN_COLUMNS = 120;

export class Pane {
  private readonly viewer: Viewer;
  private message = "";
  private size: Size | undefined;
  /** Undefined until toggled: then the width decides. */
  private showTree: boolean | undefined;
  private readonly closedDirectories = new Set<string>();
  private treeScroll = 0;
  /** The tree re-follows only when the current file changes, so scrolling the tree sticks. */
  private treeFollows: number | undefined;
  private selection: SourceSelection | null = null;
  /** A press on code started the selection, so a drag moves its end; a click on anything else stops that. */
  private selecting = false;
  /** The code row on each frame line of the last frame, and which side a column falls on. */
  private readonly cellsAt = new Map<number, { key: string; side: (x: number) => SourceSelection["side"] }>();
  /** The key list, shown in place of the diff. */
  private helpView = false;
  /** A narrow pane showing the tree in place of the diff. */
  private filesView = false;
  /** The tree row the tree that took the pane is on. */
  private treeCursor = 0;

  constructor(private readonly store: DiffStore, theme: Palette) {
    this.viewer = new Viewer(store, theme, SPLIT_COLUMNS);
  }

  subscribe(listener: () => void) {
    return this.viewer.subscribe(listener);
  }

  hover(hover: Hover | null) {
    this.viewer.setHover(hover);
  }

  /** What an input asks of the hooks module beyond a redraw: to close the pane, or to copy text. */
  input(input: Input): Outcome {
    if ("act" in input) this.act(input.act, input.alt === true);
    else if ("select" in input) this.select(input.select);
    else return this.press(input.press);
    return {};
  }

  /** Says how a copy the pane asked for went; `refusal` is the clipboard's reason when it did not. */
  copied(what: string, refusal?: string) {
    this.message = refusal ? `Not copied: ${refusal}` : `Copied ${what}`;
  }

  /** A press on a code line starts a selection on its side; a drag moves the selection's end. */
  private select({ x, y, extend }: { x: number; y: number; extend?: true }) {
    const cell = this.cellsAt.get(y);
    if (!extend) {
      this.selecting = !!cell;
      this.selection = cell ? { anchor: cell.key, end: cell.key, side: cell.side(x) } : null;
    } else if (this.selecting && this.selection && cell) this.selection = { ...this.selection, end: cell.key };
  }

  /** `recursive`: an Alt-click. */
  private act(action: Action, recursive: boolean) {
    this.message = "";
    this.selecting = false;
    if ("fold" in action) this.viewer.setFold(action.file, action.fold, "toggle", recursive);
    else if ("viewedFile" in action) this.viewer.toggleViewedFile(action.viewedFile);
    else if ("file" in action) this.viewer.toggleFile(action.file);
    else if ("jump" in action) this.goToFile(action.jump);
    else if ("dir" in action) this.toggleDirectory(action.dir);
    else if ("scrub" in action) this.viewer.scrub(action.scrub);
    else if ("files" in action) this.toggleFiles();
    else if ("pick" in action) this.viewer.pickFile(action.pick);
    else if ("help" in action) this.helpView = !this.helpView;
    else this.viewer.toggleLayout();
  }

  private press(key: KeyPress): Outcome {
    // While the search prompt or the picker is open, every key is text for it, q included.
    if (this.viewer.prompting || this.viewer.picking) {
      this.viewer.press(key);
      return {};
    }
    const plain = !key.ctrl && !key.meta;
    if (plain && key.key === "q") return { close: true };
    this.message = "";
    // The key list closes on any key but q, which closes the pane.
    if (this.helpView) {
      this.helpView = false;
      return {};
    }
    if (plain && key.key === "?") {
      this.helpView = true;
      return {};
    }
    if (!this.size) throw new Error("The pane has not been drawn yet");
    // ⌘B as in VS Code; \ for terminals that keep Cmd to themselves.
    const files = (plain && key.key === "\\") || (key.meta && key.key === "b");
    if (this.filesView) {
      if (files) this.toggleFiles();
      else this.pressFiles(key.key);
      return {};
    }
    if (plain && (key.key === "y" || key.key === "Y")) return this.copy(key.key === "Y");
    if (files) this.toggleFiles();
    else {
      // s and c reshape the rows, so the selection's rows are gone; a finished z chord is not one of them.
      const chord = this.viewer.chording;
      this.viewer.press(key);
      if (!chord && plain && (key.key === "s" || key.key === "c")) this.selection = null;
    }
    return {};
  }

  /** Too narrow for a sidebar: the tree takes the whole pane instead. */
  private narrow(size: Size) {
    return size.columns < TREE_MIN_COLUMNS;
  }

  private treeRows() {
    return flattenFileTree(buildFileTree(this.store.getSnapshot().inventory), this.closedDirectories);
  }

  /** The files key or button: in a narrow pane, swap the diff for the tree and back; otherwise show or hide the sidebar. */
  private toggleFiles() {
    if (!this.size) throw new Error("The pane has not been drawn yet");
    if (!this.narrow(this.size)) {
      this.showTree = !(this.showTree ?? true);
      return;
    }
    this.filesView = !this.filesView;
    if (this.filesView) {
      // The tree opens on the file being read.
      const { currentFile } = this.viewer.lay(this.layoutSize(this.size));
      this.treeCursor = Math.max(0, this.treeRows().findIndex((row) => row.node.fileIndex === currentFile));
    }
  }

  /** A key in the tree that took the pane: move, open a directory or go to a file. */
  private pressFiles(name: string) {
    const rows = this.treeRows();
    if (name === "j" || name === "down") this.treeCursor = Math.min(rows.length - 1, this.treeCursor + 1);
    else if (name === "k" || name === "up") this.treeCursor = Math.max(0, this.treeCursor - 1);
    else if (name === "return" || name === "enter") {
      const node = rows[this.treeCursor]?.node;
      if (!node) return;
      if (node.fileIndex === undefined) this.toggleDirectory(node.key);
      else this.goToFile(node.fileIndex);
    }
  }

  private toggleDirectory(key: string) {
    if (this.closedDirectories.has(key)) this.closedDirectories.delete(key);
    else this.closedDirectories.add(key);
  }

  /** Goes to a file from the tree; a tree that took the pane gives it back to the diff. */
  private goToFile(index: number) {
    this.viewer.jump(index);
    this.filesView = false;
  }

  /** `y` copies the selected lines as they are; `Y` as a reference an agent can read. */
  private copy(forAgent: boolean): Outcome {
    if (!this.selection) {
      this.message = "Drag across lines to select them first";
      return {};
    }
    const { snapshot, rows } = this.viewer.lay(this.layoutSize(this.size!));
    if (!snapshot.comparison) throw new Error("A selection exists before diffr named the comparison");
    const text = forAgent ? agentReference(snapshot.files, snapshot.comparison, rows, this.selection)
      : copySelection(snapshot.files, rows, this.selection);
    if (!text) {
      this.message = "The selection holds no source lines";
      return {};
    }
    return { copy: { text, what: forAgent ? "for agent" : "source lines" } };
  }

  /** `wheelColumn` is undefined for the pane's scroll keys. */
  scroll(by: number, wheelColumn: number | undefined) {
    // The tree that took the pane scrolls by moving its cursor.
    if (this.filesView) return this.pressFiles(by < 0 ? "up" : "down");
    if (wheelColumn === undefined) return this.viewer.move(by);
    if (!this.size) throw new Error("The pane has not been drawn yet");
    if (wheelColumn >= this.sidebar(this.size)) return this.viewer.move(by * 3);
    const treeRows = flattenFileTree(buildFileTree(this.store.getSnapshot().inventory), this.closedDirectories);
    this.treeScroll = Math.max(0, Math.min(Math.max(0, treeRows.length - this.bodyRows(this.size)), this.treeScroll + by * 3));
  }

  /** Includes the divider; 0 when hidden, as it always is in a narrow pane. */
  private sidebar(size: Size) {
    return !this.narrow(size) && (this.showTree ?? true) ? Math.max(16, Math.min(28, size.columns - 40)) : 0;
  }

  /** The title bar and the status line take a row each. */
  private bodyRows(size: Size) {
    return Math.max(1, size.rows - 2);
  }

  /** The diff column the viewer lays out: the tree and the scrollbar's last column are not in it. */
  private layoutSize(size: Size): Size {
    // The scrollbar takes the last column.
    return { columns: Math.max(10, size.columns - this.sidebar(size) - 1), rows: this.bodyRows(size) };
  }

  frame(size: Size): Frame {
    this.size = size;
    const viewer = this.viewer;
    const sidebar = this.sidebar(size);
    const contentWidth = this.layoutSize(size).columns;
    const at = viewer.lay(this.layoutSize(size));
    const { snapshot, theme, hover, horizontal, layout, geometry, top, viewport, currentFile, sticky, thumb } = at;
    const viewportHeight = at.size.rows;
    const { inventory, files, failures } = snapshot;
    const colors = new Colors();
    const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length]!;
    const statusGlyph = (index: number) => failures[index] || snapshot.complete ? "!" : spinner;
    // A loaded file's mark in the tree: viewed, or blank.
    const treeMark = (index: number) => (viewer.isViewed(index) ? "✓" : " ");
    const counts = files.map((file) => file && lineCounts(file));

    const title = new LineBuilder(colors, theme.chrome);
    const loaded = counts.filter((c) => c !== undefined);
    const visible = loaded.reduce((sum, c) => add(sum, c.visible), zero);
    // The files button leads the title bar; it reads as pressed while the tree has the pane.
    const button = " ☰ files ";
    title.hit(0, measureTextWidth(button), { files: true })
      .text(button, this.filesView ? theme.bg : theme.accent, this.filesView ? theme.accent : theme.chrome);
    title.text(` ${snapshot.comparison ? comparisonLabel(snapshot.comparison.lhs, snapshot.comparison.rhs) : "diffr"}`, theme.fg)
      .text(` · ${inventory.length} files · `, theme.muted)
      .text(`+${visible.added}`, theme.addedText).text(` −${visible.removed}`, theme.removedText)
      .text(snapshot.complete ? " " : "… ", theme.muted);
    for (const block of blockBar(visible))
      title.text(block === "neutral" ? "□" : "■", block === "added" ? theme.addedText : block === "removed" ? theme.removedText : theme.muted);
    // Cut the comparison, not the badge.
    const badge = `${horizontal ? `  ⇠ col ${horizontal + 1}` : ""}  ${layout} [s] `;
    title.cut(size.columns - measureTextWidth(badge)).fill(size.columns - measureTextWidth(badge), theme.chrome);
    title.hit(title.width, title.width + measureTextWidth(badge), { layout: true }).text(badge, theme.accent);
    const lines: Line[] = [title.line(size.columns)];

    // On a new current file, open its directories and scroll the tree to it.
    const currentPath = inventory[currentFile];
    if (currentPath && this.treeFollows !== currentFile)
      parentDirectories(currentPath).forEach((path) => this.closedDirectories.delete(path));
    const treeRows = flattenFileTree(buildFileTree(inventory), this.closedDirectories);
    const treeIndex = treeRows.findIndex((r) => r.node.fileIndex === currentFile);
    if (treeIndex >= 0 && this.treeFollows !== currentFile)
      this.treeScroll = treeIndex < this.treeScroll ? treeIndex
        : treeIndex >= this.treeScroll + viewportHeight ? treeIndex - viewportHeight + 1 : this.treeScroll;
    this.treeFollows = currentFile;
    const treeTop = Math.min(this.treeScroll, Math.max(0, treeRows.length - viewportHeight));

    // A file header is the diff's one band: an accent edge, then the directory dimmed so the
    // file name carries the row.
    const fileHeader = (line: LineBuilder, fileIndex: number) => {
      const file = files[fileIndex], count = counts[fileIndex]?.visible;
      const path = sanitizeTerminalLine(filePath(inventory[fileIndex]!.file));
      const shown = !!file && !!count;
      const start = line.width;
      const state = shown ? viewer.isViewed(fileIndex) : undefined, viewed = state === true;
      // The counts, then the viewed box. A viewed file is read, so its counts go.
      const tally = shown && !viewed ? [` +${count.added}`, ` −${count.removed}`] : [];
      const box = state === undefined ? "" : ` ${viewedBox(state)}`;
      // While the pointer is on the box, say what a click does beside it.
      const hint = state !== undefined && hover && "header" in hover && hover.file === fileIndex ? viewedHint(state) : "";
      const statsWidth = shown ? measureTextWidth(tally.join("") + (hint && ` ${hint}`) + box) + 1 : 0;
      const pathWidth = Math.max(1, contentWidth - statsWidth - 1);
      const glyph = shown ? (viewer.isClosed(fileIndex, file) ? "▸" : "▾") : statusGlyph(fileIndex);
      const directory = fit(`${glyph} ${path.slice(0, path.lastIndexOf("/") + 1)}`, pathWidth);
      const name = fit(path.slice(path.lastIndexOf("/") + 1), Math.max(0, pathWidth - measureTextWidth(directory)));
      const lit = viewer.headerLit(fileIndex);
      line.text("▌", viewed ? theme.muted : theme.accent, theme.fileHeader);
      for (const run of litRuns(directory, viewed ? theme.muted : theme.fileHeaderDir, theme.fileHeader, lit, theme))
        line.text(run.text, run.fg, run.bg);
      for (const run of litRuns(name, viewed ? theme.muted : shown ? theme.fg : theme.fileHeaderDir, theme.fileHeader, lit, theme))
        line.text(run.text, run.fg, run.bg, !viewed);
      line.fill(start + 1 + pathWidth, theme.fileHeader);
      if (tally.length) line.text(tally[0]!, theme.addedText, theme.fileHeader).text(tally[1]!, theme.removedText, theme.fileHeader);
      if (hint) line.text(" ", theme.fg, theme.fileHeader).text(hint, theme.bg, theme.accent);
      if (state !== undefined) {
        // Hits are matched first to last, so the box goes ahead of the header that opens the file.
        line.hit(line.width, line.width + measureTextWidth(box), { viewedFile: fileIndex });
        line.hover(line.width, line.width + measureTextWidth(box), { file: fileIndex, header: true });
        line.text(box, viewed ? theme.accent : theme.fg, theme.fileHeader);
      }
      line.fill(start + contentWidth, theme.fileHeader);
      if (shown) line.hit(start, start + contentWidth, { file: fileIndex });
    };

    // Where each code row sits, so a press or drag on a frame line finds its row and side.
    this.cellsAt.clear();
    const rowIndex = new Map(at.rows.map((row, index) => [row.key, index]));
    const [selectionStart, selectionEnd] = selectionBounds(at.rows, this.selection);
    const selectedSide = (key: string) => {
      const index = rowIndex.get(key)!;
      return index >= selectionStart && index <= selectionEnd ? this.selection!.side : undefined;
    };
    // Deferred, so each paints after the tree's columns. `y` is the line's place in the body.
    const body: ((line: LineBuilder, y: number) => void)[] = [];
    for (const measured of viewport) {
      const row = measured.row;
      for (let visualLine = Math.max(0, top - measured.top);
        visualLine < measured.height && measured.top + visualLine < top + viewportHeight - (sticky ? 1 : 0);
        visualLine++) {
        if (row.key.endsWith(":header")) body.push((line) => fileHeader(line, row.fileIndex));
        else if (row.label !== undefined)
          body.push((line) => {
            const start = line.width;
            const label = row.pending ? `    ${spinner} ${row.label}` : row.loadDiff ? `    ${row.label}` : row.label!;
            line.text(fit(sanitizeTerminalLine(label), contentWidth), row.loadDiff ? theme.accent : theme.muted, theme.bg);
            if (row.loadDiff) line.hit(start, start + contentWidth, { file: row.fileIndex });
            line.fill(start + contentWidth, theme.bg);
          });
        else
          body.push((line, y) => {
            const focus = hover?.file === row.fileIndex && "id" in hover ? hover : undefined;
            const paint = { theme, geometry, fileIndex: row.fileIndex, visualLine, focus, read: viewer.isViewed(row.fileIndex) === true };
            const selected = selectedSide(row.key);
            if (row.cell) {
              const side = row.cell.newLineNumber === undefined ? "left" : "right";
              this.cellsAt.set(y + 1, { key: row.key, side: () => side });
              paintCell(line, row.cell, measured.cell[visualLine] ?? [], geometry.leftWidth + geometry.rightWidth + 1, true,
                { ...paint, selected: selected === side });
            } else {
              paintCell(line, row.left!, measured.left[visualLine] ?? [], geometry.leftWidth, false,
                { ...paint, selected: selected === "left" });
              const divider = line.width;
              this.cellsAt.set(y + 1, { key: row.key, side: (x) => x < divider ? "left" : "right" });
              line.text("│", theme.muted, theme.bg);
              paintCell(line, row.right!, measured.right[visualLine] ?? [], geometry.rightWidth, false,
                { ...paint, selected: selected === "right" });
            }
          });
      }
    }
    // Reserve a row for the active file header once its original is above the viewport.
    if (currentFile >= 0 && sticky) body.unshift((line) => fileHeader(line, currentFile));
    if (!body.length)
      body.push((line) => line.text(snapshot.complete ? "No changed files" : `${spinner} Starting comparison…`, theme.muted, theme.bg));

    // The key list, in place of the diff; a click anywhere on it closes it.
    if (this.helpView) {
      const keyWidth = Math.max(...KEYS.map(([keys]) => measureTextWidth(keys))) + 4;
      for (let y = 0; y < viewportHeight; y++) {
        const line = new LineBuilder(colors, theme.bg), entry = KEYS[y];
        line.hit(0, size.columns, { help: true });
        if (entry) line.text(`  ${entry[0]}`, theme.accent).fill(keyWidth).text(entry[1], theme.fg);
        lines.push(line.line(size.columns));
      }
    }
    // The tree that took the pane: full width, a cursor, each file's counts at the right edge.
    else if (this.filesView) {
      this.treeCursor = Math.min(this.treeCursor, Math.max(0, treeRows.length - 1));
      this.treeScroll = this.treeCursor < this.treeScroll ? this.treeCursor
        : this.treeCursor >= this.treeScroll + viewportHeight ? this.treeCursor - viewportHeight + 1 : this.treeScroll;
      for (let y = 0; y < viewportHeight; y++) {
        const line = new LineBuilder(colors, theme.bg), index = this.treeScroll + y, entry = treeRows[index];
        if (entry) {
          const { node, depth } = entry, file = node.fileIndex;
          const cursor = index === this.treeCursor, bg = cursor ? theme.highlight : theme.bg;
          const read = file !== undefined && viewer.isViewed(file) === true;
          const count = file === undefined || read ? undefined : counts[file]?.visible;
          const tally = count ? [` +${count.added}`, ` −${count.removed} `] : [" "];
          const label = "  ".repeat(depth) + (file === undefined ? (this.closedDirectories.has(node.key) ? "▸ " : "▾ ")
            : `${files[file] ? treeMark(file) : statusGlyph(file)} `) + node.name;
          const width = size.columns - 2 - measureTextWidth(tally.join(""));
          line.text(cursor ? "▸ " : "  ", theme.accent, bg)
            .text(fit(sanitizeTerminalLine(label), width), file === currentFile ? theme.accent : file === undefined || read ? theme.muted : theme.fg,
              bg, file === currentFile)
            .fill(2 + width, bg);
          if (count) line.text(tally[0]!, theme.addedText, bg).text(tally[1]!, theme.removedText, bg);
          line.fill(size.columns, bg);
          line.hit(0, size.columns, file === undefined ? { dir: node.key } : { jump: file });
        }
        lines.push(line.line(size.columns));
      }
    }
    for (let y = 0; y < (this.filesView || this.helpView ? 0 : viewportHeight); y++) {
      const line = new LineBuilder(colors, theme.bg);
      if (sidebar > 0) {
        const entry = treeRows[treeTop + y];
        if (entry) {
          const { node, depth } = entry;
          const current = node.fileIndex === currentFile;
          const label = "  ".repeat(depth) + (node.fileIndex === undefined
            ? (this.closedDirectories.has(node.key) ? "▸ " : "▾ ")
            : `▤ ${files[node.fileIndex] ? treeMark(node.fileIndex) : statusGlyph(node.fileIndex)} `) + node.name;
          const read = node.fileIndex !== undefined && viewer.isViewed(node.fileIndex) === true;
          line.text(fit(sanitizeTerminalLine(label), sidebar - 1),
            current ? theme.accent : node.fileIndex === undefined || read ? theme.muted : theme.fg,
            current ? theme.highlight : theme.bg);
          line.fill(sidebar - 1, current ? theme.highlight : theme.bg);
          line.hit(0, sidebar - 1, node.fileIndex === undefined ? { dir: node.key } : { jump: node.fileIndex });
        }
        line.fill(sidebar - 1).text("│", theme.muted);
      }
      body[y]?.(line, y);
      line.fill(sidebar + contentWidth);
      const onThumb = y >= thumb.top && y < thumb.top + thumb.height;
      line.hit(line.width, line.width + 1, { scrub: y }).text(" ", theme.muted, onThumb ? theme.muted : theme.bg);
      lines.push(line.line(size.columns));
    }

    // The Ctrl-P picker takes the bottom of the body, up to ten lines, over whatever was there.
    const picker = viewer.pickerState();
    if (picker) {
      const drawn = pickerLines(picker, size.columns, Math.min(10, viewportHeight), theme,
        (index) => counts[index]?.visible, (index) => viewer.isViewed(index) === true, "ctrl-c close");
      lines.splice(lines.length - drawn.length, drawn.length, ...drawn.map(({ runs, pick }) => {
        const line = new LineBuilder(colors, theme.chrome);
        if (pick !== undefined) line.hit(0, size.columns, { pick });
        for (const run of runs) line.text(run.text, run.fg, run.bg, run.bold);
        return line.line(size.columns);
      }));
    }
    const status = new LineBuilder(colors, theme.bg);
    const errors = snapshot.errors.length ? `${snapshot.errors.length} errors  ` : "";
    const read = viewer.viewedFiles();
    // A message leads, so a narrow pane cuts the key hints rather than what just happened.
    // While typing, the status line is the prompt; after a search, it leads with where the search stands.
    const found = viewer.searchState();
    if (found && "prompt" in found)
      status.text(fit(`/${found.prompt}▏ · ${found.count} matches · ⏎ go · ctrl-c cancel`, size.columns), theme.fg);
    else {
      const searched = !found ? ""
        : `/${found.pattern} · ${found.total ? `match ${found.at} of ${found.total} in ${found.files} files · n/N` : "no matches"} · `;
      // Where the reader is, as vim's status line says it: the file, which of how many, how far through.
      const order = flattenFileTree(buildFileTree(inventory), new Set()).flatMap(({ node }) =>
        node.fileIndex === undefined ? [] : [node.fileIndex]);
      const name = inventory[currentFile] ? filePath(inventory[currentFile]!.file).split("/").at(-1) : undefined;
      const where = name === undefined ? ""
        : `${name} · file ${order.indexOf(currentFile) + 1} of ${order.length} · ${at.maxScroll ? Math.round((top / at.maxScroll) * 100) : 100}% · `;
      const loading = snapshot.complete ? "" : `${snapshot.loaded}/${inventory.length} loaded… `;
      const keys = this.filesView ? " j/k move · ⏎ open · \\ or ⌘B back"
        : " [/] hunks · / search · ctrl-p files · \\ or ⌘B tree · V viewed · drag selects · y/Y copy";
      // The hints give way first, cut with an ellipsis; ? keys stays at the right end, and a click on it shows them all.
      const room = size.columns - measureTextWidth(KEYS_BUTTON);
      const text = `${this.message ? `${this.message} · ` : ""}${searched}${this.filesView ? "" : where}${read.viewed}/${read.total} viewed ${loading}${errors}${keys}`;
      status.text(measureTextWidth(text) > room ? `${fit(text, room - 1)}…` : text, theme.muted).fill(room);
      status.hit(room, size.columns, { help: true }).text(KEYS_BUTTON, this.helpView ? theme.bg : theme.accent, this.helpView ? theme.accent : theme.bg);
    }
    lines.push(status.line(size.columns));
    return { colors: colors.list, fg: colors.of(theme.fg), lines, hover };
  }
}
