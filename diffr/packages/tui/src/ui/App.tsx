/** Coordinate viewer interactions; Rust owns every comparison and source correspondence. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { buildFileTree, flattenFileTree, parentDirectories, lineCounts } from "../diffr/fileTree";
import { matchesKey } from "./lib/keys";
import { resizeSidebarWidth } from "./lib/sidebar";
import { CodeRowView } from "./diff/CodeRowView";
import type { ScopeFocus } from "./diff/diffRowModel";
import {
  rowsForFile,
  type Layout,
  type ViewerRow,
} from "../diffr/rows";
import type { Palette } from "../diffr/palette";
import type { ThemeSet } from "../diffr/theme";
import { measureRows, visibleRows, positionAt, positionTop, rowFold, type ViewPosition } from "../diffr/geometry";
import {
  copySelection,
  selectionBounds,
  type SourceSelection,
} from "../diffr/selection";
import { filePath, fileVisibility, type DiffFile, type TextDiff } from "../diffr/wire";
import { defaultCollapsed, foldIds, gapIds, nestedIds, sourceLines } from "../diffr/regions";
import { placeholderRows } from "../diffr/rows";
import { add, blockBar, comparisonLabel, zero, type LineCounts } from "../diffr/counts";
import type { DiffStore } from "../diffr/store";
import { sanitizeTerminalLine } from "../lib/terminalText";
import { measureTextWidth, sliceTextByWidth } from "./lib/text";
const fit = (text: string, width: number) =>
  sliceTextByWidth(text, 0, width).text;
export function App({
  store,
  onQuit,
  themes,
}: {
  store: DiffStore;
  onQuit: () => void;
  themes: ThemeSet;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const renderer = useRenderer(),
    { width, height } = useTerminalDimensions();
  const [mode, setMode] = useState<Layout | "auto">("auto"),
    [showSidebar, setShowSidebar] = useState(true),
    [wrap, setWrap] = useState(false),
    [theme, setTheme] = useState<Palette>(themes.initial);
  const [position, setPosition] = useState<ViewPosition | null>(null);
  const [horizontal, setHorizontal] = useState(0);
  const [hoveredFold, setHoveredFold] = useState<{file: number; focus: ScopeFocus} | null>(null);
  const [spinner, setSpinner] = useState(0);
  useEffect(() => {
    if (snapshot.complete) return;
    const timer = setInterval(() => setSpinner(n => (n + 1) % 10), 80);
    return () => clearInterval(timer);
  }, [snapshot.complete]);
  const loadingGlyph = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[spinner];
  // Files the user closed or opened; unset files follow the visibility on their file record.
  const [closed, setClosed] = useState<Map<number, boolean>>(new Map());
  const [selection, setSelection] = useState<SourceSelection | null>(null),
    [message, setMessage] = useState("");
  // Fold ids collapsed per manifest file; unset files start where diffr's visibility says.
  const [collapsed, setCollapsed] = useState<Map<number, ReadonlySet<number>>>(new Map());
  // Vim's z prefix: the next key names the fold command.
  const pendingZ = useRef(false);
  const [closedDirectories, setClosedDirectories] = useState<Set<string>>(new Set());
  const [treeScroll, setTreeScroll] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(28);
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const dragging = useRef(false),
    thumbDragging = useRef(false);
  // `t` swaps between the two bundled defaults; a configured theme is left by the first press.
  const toggleTheme = () => setTheme((current) => (current.isLight ? themes.dark : themes.light));
  const sidebar = showSidebar && width >= 60 ? Math.max(16, Math.min(sidebarWidth, width - 40)) : 0;
  const contentWidth = Math.max(10, width - sidebar - 1),
    viewportHeight = Math.max(1, height - 3);
  const layout =
    mode === "auto" ? (contentWidth >= 100 ? "split" : "unified") : mode;
  // Viewer state is keyed by manifest index; `files[i]` is undefined until file i arrives.
  const { inventory, files, failures } = snapshot;
  const textDiffs = useMemo(() => files.flatMap((file, index) =>
    file?.diff.type === "text" ? [{ index, diff: file.diff }] : []), [files]);
  const foldsOf = (index: number, diff: TextDiff): ReadonlySet<number> => collapsed.get(index) ?? defaultCollapsed(diff);
  const isClosed = (index: number, file: DiffFile) => closed.get(index) ?? fileVisibility(file).collapsed;
  // The file's mark in the tree and on its header while it has no diff.
  const statusGlyph = (index: number) => failures[index] || snapshot.complete ? "!" : loadingGlyph;
  const tree = useMemo(() => buildFileTree(inventory), [inventory]);
  const fileOrder = useMemo(() => flattenFileTree(tree, new Set()).flatMap(({node}) =>
    node.fileIndex === undefined ? [] : [node.fileIndex]), [tree]);
  const rowCache = useRef(
    new WeakMap<DiffFile, { key: string; rows: ViewerRow[] }>(),
  );
  const rows = useMemo(() => {
    const perFile = fileOrder.map((index): ViewerRow[] => {
      const file = files[index];
      if (!file) {
        const failure = failures[index];
        const status = failure ?? (snapshot.complete ? "File did not load" : "Computing diff…");
        return [{ key: `${index}:header`, fileIndex: index, label: filePath(inventory[index].file) },
          ...["", status, "", ""].map((label, line) => ({ key: `${index}:pending:${line}`, fileIndex: index,
            label, pending: line === 1 && !failure && !snapshot.complete }))];
      }
      const folds = file.diff.type === "text" ? foldsOf(index, file.diff) : new Set<number>();
      const key = `${index}:${layout}:${theme.name}:${[...folds].sort((a, b) => a - b).join(",")}`;
      let cached = rowCache.current.get(file);
      if (cached?.key !== key) {
        cached = { key, rows: rowsForFile(file, index, layout, theme, folds) };
        rowCache.current.set(file, cached);
      }
      if (!isClosed(index, file)) return cached.rows;
      return fileVisibility(file).collapsed
        ? [cached.rows[0], ...placeholderRows(index, fileVisibility(file).label)]
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
  }, [files, failures, snapshot.errors, snapshot.complete, inventory, layout, theme, closed, fileOrder, collapsed]);
  const maxLine = useMemo(() => Math.max(1, ...textDiffs.flatMap(({ diff }) =>
    [diff.lhs, diff.rhs].map(source => source ? sourceLines(source.text).length : 0))), [textDiffs]);
  const geometry = useMemo(
    () => measureRows(rows, contentWidth, wrap, horizontal, maxLine),
    [rows, contentWidth, wrap, horizontal, maxLine],
  );
  const lastFileTop = useMemo(() =>
    geometry.rows.findLast(r => r.row.key.endsWith(":header"))?.top ?? 0, [geometry]);
  // One past the end, since the sticky file header takes the viewport's first row.
  const maxScroll = Math.max(lastFileTop, geometry.height - viewportHeight + 1);
  const clamp = (value: number) => Math.max(0, Math.min(maxScroll, value));
  const top = Math.min(positionTop(geometry, position), maxScroll);
  const scrollTo = (value: number) => setPosition(positionAt(geometry, clamp(value)));
  // Relative to the latest position, so key repeats within one frame add up.
  const move = (amount: number) =>
    setPosition(current => positionAt(geometry, clamp(Math.min(positionTop(geometry, current), maxScroll) + amount)));
  const toggleFile = (index: number) => {
    const file = files[index];
    if (!file) return;
    // Toggling the file being read moves to its header; the rows above it stay put.
    const header = geometry.rows.find(r => r.row.key === `${index}:header`)!;
    if (header.top < top) setPosition({ key: header.row.key, fileIndex: index, offset: 0, side: "right" });
    setClosed(old => new Map(old).set(index, !(old.get(index) ?? fileVisibility(file).collapsed)));
  };
  // "toggle" reads the current state inside the update, so quick repeated clicks alternate.
  const setFolds = (fileIndex: number, diff: TextDiff, ids: number[], collapse: boolean | "toggle") =>
    setCollapsed((old) => {
      const next = new Set(old.get(fileIndex) ?? defaultCollapsed(diff));
      const close = collapse === "toggle" ? !next.has(ids[0]) : collapse;
      for (const id of ids) if (close) next.add(id); else next.delete(id);
      return new Map(old).set(fileIndex, next);
    });
  // Recursive commands (Alt-click, zC, zO, zA) include every fold nested inside.
  const setFold = (fileIndex: number, id: number, collapse: boolean | "toggle", recursive: boolean) => {
    const diff = files[fileIndex]?.diff;
    if (diff?.type !== "text") throw new Error(`File ${fileIndex} has no folds`);
    setFolds(fileIndex, diff, recursive ? [id, ...nestedIds(diff, id)] : [id], collapse);
  };
  // `c`: reveal every context gap, or hide them again.
  const toggleContext = () => {
    const opened = textDiffs.some(({ index, diff }) => gapIds(diff).some((id) => !foldsOf(index, diff).has(id)));
    textDiffs.forEach(({ index, diff }) => setFolds(index, diff, gapIds(diff), opened));
  };
  const toggleFold = (fileIndex: number, id: number, recursive: boolean) =>
    setFold(fileIndex, id, "toggle", recursive);
  const navigateFold = (direction: number) => {
    const headers = geometry.rows.filter((r) => rowFold(r.row));
    const target =
      direction > 0
        ? headers.find((r) => r.top > top)
        : headers.findLast((r) => r.top < top);
    if (target) scrollTo(target.top);
  };
  // Vim fold commands act on the fold whose header is the top visible row.
  const foldCommand = (command: string) => {
    if (command === "R") return foldAll(false);
    if (command === "M") return foldAll(true);
    if (command === "j") return navigateFold(1);
    if (command === "k") return navigateFold(-1);
    const current = visibleRows(geometry, top, 1)[0]?.row;
    const fold = current && rowFold(current);
    if (!current || !fold) return;
    const recursive = command === command.toUpperCase();
    const letter = command.toLowerCase();
    if (letter === "a") toggleFold(current.fileIndex, fold.id, recursive);
    else if (letter === "o") setFold(current.fileIndex, fold.id, false, recursive);
    else if (letter === "c") setFold(current.fileIndex, fold.id, true, recursive);
  };
  const foldAll = (collapse: boolean) =>
    textDiffs.forEach(({ index, diff }) => setFolds(index, diff, foldIds(diff), collapse));
  const jump = (index: number) => scrollTo(geometry.rows.find((r) => r.row.fileIndex === index)!.top);
  const navigateHunk = (direction: number) => {
    const headers = geometry.rows.filter((r) => r.row.hunkStart);
    const target =
      direction > 0
        ? headers.find((r) => r.top > top)
        : headers.findLast((r) => r.top < top);
    if (target) scrollTo(target.top);
  };
  const copy = () => {
    if (!selection) return;
    const text = copySelection(files, rows, selection);
    if (text) {
      renderer.copyToClipboardOSC52(text);
      setMessage("Copied source lines");
    }
  };
  useKeyboard((key) => {
    // Hunk's chord matcher handles raw control bytes and Kitty events alike.
    const is = (...chords: string[]) => !key.super && chords.some(chord => matchesKey(chord, key));
    if (pendingZ.current) {
      pendingZ.current = false;
      const command = key.shift ? key.name?.toUpperCase() : key.name;
      if (!key.ctrl && !key.meta && command?.length === 1 && "aocAOCRMjk".includes(command))
        foldCommand(command);
      return;
    }
    if (is("q", "ctrl+c")) onQuit();
    else if ((key.name === "b" && (key.super || key.meta)) || is("\\")) {
      key.preventDefault(); setShowSidebar(v => !v);
    }
    else if (is("d", "ctrl+d", "u", "ctrl+u"))
      move((is("d", "ctrl+d") ? 1 : -1) * Math.max(1, Math.floor(viewportHeight / 2)));
    else if (is("pagedown", "space", "f", "ctrl+f")) move(viewportHeight);
    else if (is("pageup", "b", "shift+space", "ctrl+b")) move(-viewportHeight);
    else if (is("down", "j")) move(1);
    else if (is("up", "k")) move(-1);
    else if (is("g")) scrollTo(0);
    else if (is("home")) scrollTo(0);
    else if (is("G", "end")) scrollTo(maxScroll);
    else if (is("right", "shift+right", "l")) setHorizontal(n => n + (key.shift ? 16 : 4));
    else if (is("left", "shift+left", "h")) setHorizontal(n => Math.max(0, n - (key.shift ? 16 : 4)));
    else if (key.name === "]") navigateHunk(1);
    else if (key.name === "[") navigateHunk(-1);
    else if (key.name === "s") {
      setMode(layout === "split" ? "unified" : "split");
      setSelection(null);
    } else if (key.name === "w") setWrap((v) => !v);
    else if (key.name === "c") { toggleContext(); setSelection(null); }
    else if (key.name === "t") toggleTheme();
    else if (key.name === "y") copy();
    else if (key.name === "escape") { setSelection(null); setMenu(null); setShowBreakdown(false); }
    else if (key.name === "i") setShowBreakdown((v) => !v);
    else if (key.name === "return") {
      const current = visibleRows(geometry, top, 1)[0];
      if (current && current.row.fileIndex >= 0)
        toggleFile(current.row.fileIndex);
    } else if (is("z")) pendingZ.current = true;
  });
  const [selectionStart, selectionEnd] = useMemo(
    () => selectionBounds(rows, selection),
    [rows, selection],
  );
  const indices = useMemo(
    () => new Map(rows.map((row, i) => [row.key, i])),
    [rows],
  );
  const viewport = visibleRows(geometry, top, viewportHeight);
  const currentFile = viewport[0]?.row.fileIndex ?? 0;
  const sticky = !!viewport.length && !viewport[0].row.key.endsWith(":header");
  // Shortcuts past a file that is still loading.
  const place = fileOrder.indexOf(currentFile);
  const previousLoaded = fileOrder.slice(0, place).findLast(index => files[index]);
  const nextLoaded = fileOrder.slice(place + 1).find(index => files[index]);
  const treeRows = useMemo(() => flattenFileTree(tree, closedDirectories), [tree, closedDirectories]);
  const counts = useMemo(() => files.map(file => file && lineCounts(file)), [files]);
  // Headline numbers are diffr's stats.visible, verbatim: folding never changes them.
  const totals = useMemo(() => {
    const loaded = counts.filter(c => c !== undefined);
    return {
      visible: loaded.reduce((sum, c) => add(sum, c.visible), zero),
      textual: loaded.reduce((sum, c) => add(sum, c.textual), zero),
      fallbacks: loaded.filter((c) => c.fallback).length,
    };
  }, [counts]);
  const plusMinus = (c: LineCounts) => `+${c.added} −${c.removed}`;
  useEffect(() => {
    const file = inventory[currentFile];
    if (!file) return;
    setClosedDirectories(old => {
      const next = new Set(old);
      parentDirectories(file).forEach(path => next.delete(path));
      return next.size === old.size ? old : next;
    });
  }, [currentFile, inventory]);
  useEffect(() => {
    const index = treeRows.findIndex(r => r.node.fileIndex === currentFile);
    if (index >= 0) setTreeScroll(old => index < old ? index
      : index >= old + viewportHeight ? index - viewportHeight + 1 : old);
  }, [currentFile, treeRows, viewportHeight]);
  const sidebarStart = Math.min(treeScroll, Math.max(0, treeRows.length - viewportHeight));
  // A file header is the diff's one band: an accent edge, then the directory dimmed so the file
  // name carries the row.
  const fileHeader = (fileIndex: number, key: string) => {
    const file = files[fileIndex], count = counts[fileIndex]?.visible;
    const path = sanitizeTerminalLine(filePath(inventory[fileIndex].file));
    const loaded = !!file && !!count;
    const statsWidth = loaded ? String(count.added).length + String(count.removed).length + 5 : 0;
    const pathWidth = Math.max(1, contentWidth - statsWidth - 1);
    const glyph = loaded ? (isClosed(fileIndex, file) ? "▸" : "▾") : statusGlyph(fileIndex);
    const directory = fit(`${glyph} ${path.slice(0, path.lastIndexOf("/") + 1)}`, pathWidth);
    const directoryWidth = measureTextWidth(directory);
    const name = fit(path.slice(path.lastIndexOf("/") + 1), Math.max(0, pathWidth - directoryWidth));
    return <box key={key} height={1} width={contentWidth} flexDirection="row"
      backgroundColor={theme.fileHeader}
      onMouseUp={() => { if (loaded) toggleFile(fileIndex); }}>
      <text width={1} fg={theme.accent} selectable={false}>▌</text>
      <text width={directoryWidth} fg={theme.fileHeaderDir} selectable={false}>{directory}</text>
      <text width={Math.max(0, pathWidth - directoryWidth)} fg={loaded ? theme.fg : theme.fileHeaderDir}
        attributes={TextAttributes.BOLD} selectable={false}>{name}</text>
      {loaded && <>
        <text fg={theme.addedText} selectable={false}>{` +${count.added}`}</text>
        <text fg={theme.removedText} selectable={false}>{` −${count.removed} `}</text>
      </>}
    </box>;
  };
  const rendered = [];

  for (const measured of viewport) {
    const row = measured.row,
      index = indices.get(row.key)!;
    for (
      let line = Math.max(0, top - measured.top);
      line < measured.height && measured.top + line < top + viewportHeight - (sticky ? 1 : 0);
      line++
    ) {
      if (row.key.endsWith(":header"))
        rendered.push(fileHeader(row.fileIndex, row.key));
      else if (row.label !== undefined)
        rendered.push(
          <text
            key={row.key}
            height={1}
            width={contentWidth}
            fg={row.loadDiff ? theme.accent : theme.muted}
            selectable={false}
            onMouseUp={() => {
              if (row.loadDiff) toggleFile(row.fileIndex);
            }}
          >
            {fit(sanitizeTerminalLine(row.pending ? `    ${loadingGlyph} ${row.label}` : row.loadDiff ? `    ${row.label}` : row.label), contentWidth)}
          </text>,
        );
      else
        rendered.push(
          <CodeRowView
            key={`${row.key}:${line}`}
            measured={measured}
            visualLine={line}
            geometry={geometry}
            theme={theme}
            selectedSide={
              selection && index >= selectionStart && index <= selectionEnd
                ? selection.side
                : undefined
            }
            onSelect={(side) => {
              dragging.current = true;
              setSelection({ anchor: row.key, end: row.key, side });
            }}
            onExtend={() => {
              if (dragging.current)
                setSelection((s) => (s ? { ...s, end: row.key } : s));
            }}
            focus={hoveredFold?.file === row.fileIndex ? hoveredFold.focus : undefined}
            onHover={focus => setHoveredFold(old => old?.file === row.fileIndex && old.focus.id === focus?.id
              && old.focus.armed === focus.armed ? old : focus === undefined ? null : {file: row.fileIndex, focus})}
            onFold={(id, recursive) => toggleFold(row.fileIndex, id, recursive)}
          />,
        );
    }
  }
  // Reserve a row for the active file header once its original is above the viewport.
  if (currentFile >= 0 && sticky) {
    rendered.unshift(fileHeader(currentFile, "sticky-header"));
  }
  const thumbHeight = Math.max(
    1,
    Math.floor(
      (viewportHeight * viewportHeight) /
        Math.max(viewportHeight, geometry.height),
    ),
  );
  const thumbTop = maxScroll
    ? Math.round((top / maxScroll) * (viewportHeight - thumbHeight))
    : 0;
  function scrub(y: number) {
    scrollTo(
      Math.round(
        Math.max(0, Math.min(1, (y - 2) / Math.max(1, viewportHeight - 1))) *
          maxScroll,
      ),
    );
  }
  const menuItems: Record<string, [string, () => void][]> = {
    File: [["Toggle file tree  ⌘B / \\", () => setShowSidebar(v => !v)], ["Copy selection  y", copy], ["Quit  q", onQuit]],
    View: [[`Layout: ${layout}  s`, () => { setMode(layout === "split" ? "unified" : "split"); setSelection(null); }],
      [`Wrap: ${wrap ? "on" : "off"}  w`, () => setWrap(v => !v)],
      ["Toggle context gaps  c", () => { toggleContext(); setSelection(null); }],
      ["Fold all  zM", () => foldAll(true)], ["Unfold all  zR", () => foldAll(false)]],
    Navigate: [["Previous change  [", () => navigateHunk(-1)], ["Next change  ]", () => navigateHunk(1)],
      ["First file  Home", () => scrollTo(0)], ["Last file  End", () => scrollTo(maxScroll)]],
    Theme: [[`Dark (${themes.dark.name})  t`, () => setTheme(themes.dark)], [`Light (${themes.light.name})  t`, () => setTheme(themes.light)]],
    Help: [["Scroll: j/k · h/l · gg/G", () => setMessage("j/k scroll · h/l pan · gg first · G last")],
      ["Half page: Ctrl-D / Ctrl-U", () => setMessage("d / Ctrl-D: half down · u / Ctrl-U: half up")],
      ["Full page: Ctrl-F / Ctrl-B", () => setMessage("Ctrl-F: page down · Ctrl-B: page up")],
      ["Drag to select · y to copy", () => setMessage("Drag source lines; y copies original source")],
      ["Change breakdown  i", () => setShowBreakdown(true)],
      ["Folds: click ▾ · za zo zc · zM zR", () => setMessage("Click the chevron or ⋯ · za toggle, zo open, zc close the top fold (zA zO zC recursive) · zM/zR fold/unfold all · zj/zk next/previous fold")]],
  };
  return (
    <box
      width={width}
      height={height}
      flexDirection="column"
      backgroundColor={theme.bg}
      onMouseDrag={(event) => {
        if (sidebarDrag.current) {
          setSidebarWidth(resizeSidebarWidth(sidebarDrag.current.width,
            sidebarDrag.current.x, event.x, 16, width - 40));
        } else if (thumbDragging.current) scrub(event.y);
        else if (dragging.current && !(event.y === 2 && !viewport[0]?.row.key.endsWith(":header"))) {
          const target = visibleRows(
            geometry,
            Math.max(0, top + event.y - 2 - (sticky ? 1 : 0)),
            1,
          )[0]?.row;
          if (target && target.label === undefined)
            setSelection((s) => (s ? { ...s, end: target.key } : s));
        }
      }}
      onMouseUp={() => {
        dragging.current = false;
        thumbDragging.current = false;
        sidebarDrag.current = null;
      }}
    >
      <box height={1} flexDirection="row" backgroundColor={theme.chrome}>
        {["File", "View", "Navigate", "Theme", "Help"].map(name => (
          <text key={name} fg={menu === name ? theme.accent : theme.fg} selectable={false}
            onMouseUp={() => setMenu(old => old === name ? null : name)}>
            {` ${name} `}
          </text>
        ))}
        <text fg={theme.accent} selectable={false} onMouseUp={() => {
          setMode(layout === "split" ? "unified" : "split"); setSelection(null);
        }}>{`  ${layout} [s] `}</text>
      </box>
      <box height={1} flexDirection="row" backgroundColor={theme.chrome}>
        <text fg={theme.fg} selectable={false}>
          {` ${snapshot.comparison ? comparisonLabel(snapshot.comparison.lhs, snapshot.comparison.rhs) : "diffr"}`}
        </text>
        <text fg={theme.muted} selectable={false}>{` · ${inventory.length} files · `}</text>
        <text fg={theme.addedText} selectable={false} onMouseUp={() => setShowBreakdown((v) => !v)}>{`+${totals.visible.added}`}</text>
        <text fg={theme.removedText} selectable={false} onMouseUp={() => setShowBreakdown((v) => !v)}>{` −${totals.visible.removed}`}</text>
        <text fg={theme.muted} selectable={false}>{snapshot.complete ? " " : "… "}</text>
        {blockBar(totals.visible).map((block, i) => (
          <text key={i} fg={block === "added" ? theme.addedText : block === "removed" ? theme.removedText : theme.muted}
            selectable={false} onMouseUp={() => setShowBreakdown((v) => !v)}>{block === "neutral" ? "□" : "■"}</text>
        ))}
      </box>
      <box
        height={viewportHeight}
        flexDirection="row"
        onMouseScroll={(event) => {
          const d = event.scroll;
          if (d) {
            if (d.direction === "left" || d.direction === "right")
              setHorizontal((n) =>
                Math.max(0, n + (d.direction === "left" ? -4 : 4)),
              );
            else
              move((d.direction === "up" ? -1 : 1) * Math.max(1, d.delta) * 3);
          }
        }}
      >
        {sidebar > 0 && (
          <box width={sidebar} flexDirection="row">
          <box width={sidebar - 1} flexDirection="column" onMouseScroll={event => {
            event.stopPropagation();
            const scrollEvent = event.scroll;
            if (scrollEvent) setTreeScroll(n => Math.max(0, Math.min(
              Math.max(0, treeRows.length - viewportHeight),
              n + (scrollEvent.direction === "up" ? -3 : 3))));
          }}>
            {treeRows.slice(sidebarStart, sidebarStart + viewportHeight).map(({node, depth}) => (
              <text key={node.key} height={1} width={sidebar - 1}
                fg={node.fileIndex === currentFile ? theme.accent : node.fileIndex === undefined ? theme.muted : theme.fg}
                bg={node.fileIndex === currentFile ? theme.highlight : theme.bg}
                selectable={false}
                onMouseUp={() => {
                  if (node.fileIndex !== undefined) {
                    setMessage(""); jump(node.fileIndex);
                  }
                  else setClosedDirectories(old => {
                    const next = new Set(old);
                    if (next.has(node.key)) next.delete(node.key); else next.add(node.key);
                    return next;
                  });
                }}>
                {fit(sanitizeTerminalLine("  ".repeat(depth) + (node.fileIndex === undefined
                  ? (closedDirectories.has(node.key) ? "▸ " : "▾ ")
                  : `▤ ${files[node.fileIndex] ? " " : statusGlyph(node.fileIndex)} `) + node.name), sidebar - 1)}
              </text>
            ))}
          </box>
          <box width={1} height={viewportHeight}
            onMouseDown={event => {
              if (event.button !== 0) return;
              event.stopPropagation();
              dragging.current = false;
              sidebarDrag.current = {x: event.x, width: sidebar};
            }}>
            <text width={1} height={viewportHeight} fg={theme.muted} selectable={false}>
              {Array.from({length: viewportHeight}, () => "│").join("\n")}
            </text>
          </box>
          </box>
        )}
        <box
          width={contentWidth}
          height={viewportHeight}
          flexDirection="column"
          overflow="hidden"
        >
          {currentFile >= 0 && !files[currentFile] && !snapshot.complete &&
            <box position="absolute" top={Math.min(3, viewportHeight - 1)} right={2} height={1} flexDirection="row" zIndex={5} backgroundColor={theme.chrome}>
              {previousLoaded !== undefined && <text fg={theme.accent} selectable={false} onMouseUp={event => { event.stopPropagation(); jump(previousLoaded); }}> ↑ previous loaded </text>}
              {nextLoaded !== undefined && <text fg={theme.accent} selectable={false} onMouseUp={event => { event.stopPropagation(); jump(nextLoaded); }}> ↓ next loaded </text>}
            </box>}
          {rendered.length ? (
            rendered
          ) : (
            <text fg={theme.muted}>
              {snapshot.complete ? "No changed files" : `${loadingGlyph} Starting comparison…`}
            </text>
          )}
        </box>
        <box
          width={1}
          height={viewportHeight}
          onMouseDown={(event) => {
            thumbDragging.current = true;
            scrub(event.y);
          }}
          onMouseMove={(event) => {
            if (sidebarDrag.current) {
          setSidebarWidth(resizeSidebarWidth(sidebarDrag.current.width,
            sidebarDrag.current.x, event.x, 16, width - 40));
        } else if (thumbDragging.current) scrub(event.y);
          }}
        >
          <box
            position="absolute"
            top={thumbTop}
            width={1}
            height={thumbHeight}
            backgroundColor={theme.muted}
          />
        </box>
      </box>
      {showBreakdown && (() => {
        const file = files[currentFile];
        const count = counts[currentFile];
        const fallback = count?.fallback;
        const sections: [string, LineCounts, LineCounts, string | null][] = [
          ["All files", totals.visible, totals.textual, totals.fallbacks ? `line diff: ${totals.fallbacks} files` : null],
          ...(file && count ? [[filePath(file.file), count.visible, count.textual,
            fallback ? `line diff: ${fallback.code}` : null] as [string, LineCounts, LineCounts, string | null]] : []),
        ];
        const boxWidth = Math.min(width, 44);
        const rowCount = sections.reduce((n, s) => n + 3 + (s[3] ? 1 : 0), 0);
        return <box position="absolute" top={2} left={Math.max(0, width - boxWidth - 1)} width={boxWidth}
          height={rowCount + 1} flexDirection="column" zIndex={10} backgroundColor={theme.chrome}>
          {sections.flatMap(([title, visible, textual, note]) => [
            <text key={`${title}:t`} height={1} fg={theme.fg} selectable={false}>{fit(` ${title}`, boxWidth)}</text>,
            <text key={`${title}:v`} height={1} fg={theme.muted} selectable={false}>{fit(`   visible   ${plusMinus(visible)}`, boxWidth)}</text>,
            <text key={`${title}:x`} height={1} fg={theme.muted} selectable={false}>{fit(`   textual   ${plusMinus(textual)}`, boxWidth)}</text>,
            ...(note ? [<text key={`${title}:f`} height={1} fg={theme.muted} selectable={false}>{fit(`   ${note}`, boxWidth)}</text>] : []),
          ])}
          <text height={1} fg={theme.muted} selectable={false}>{fit(" esc close", boxWidth)}</text>
        </box>;
      })()}
      {menu && <box position="absolute" top={1} left={0} width={38}
        height={menuItems[menu].length} flexDirection="column" zIndex={10}
        backgroundColor={theme.chrome}>
        {menuItems[menu].map(([label, action]) => (
          <text key={label} height={1} width={38} fg={theme.fg} selectable={false}
            onMouseUp={() => { action(); setMenu(null); }}>
            {" " + label}
          </text>
        ))}
      </box>}
      <text height={1} fg={theme.muted} selectable={false}>
        {fit(
          `${snapshot.loaded}/${inventory.length} files ${snapshot.complete ? "" : "loading…"} ${snapshot.errors.length ? `${snapshot.errors.length} errors` : ""}  [/] hunks · za fold · i breakdown · drag selects lines · y copy · q quit ${message}`,
          width,
        )}
      </text>
    </box>
  );
}
