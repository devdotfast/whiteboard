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
import { TextAttributes, type KeyEvent } from "@opentui/core";
import { buildFileTree, flattenFileTree, lineCounts, parentDirectories } from "@diffr/viewer/document/fileTree";
import { matchesKey } from "./lib/keys";
import { resizeSidebarWidth } from "./lib/sidebar";
import { CodeRowView, styled } from "./diff/CodeRowView";
import type { ThemeSet } from "../diffr/theme";
import {
  agentReference,
  copySelection,
  rangeName,
  selectedRanges,
  selectionBounds,
  type SourceSelection,
} from "@diffr/viewer/document/selection";
import { filePath } from "@diffr/viewer/protocol/wire";
import { add, blockBar, comparisonLabel, zero, type LineCounts } from "@diffr/viewer/document/counts";
import type { DiffStore } from "@diffr/viewer/protocol/store";
import { visibleRows } from "@diffr/viewer/viewport/geometry";
import { sanitizeTerminalLine } from "@diffr/viewer/terminal/sanitize";
import { measureTextWidth, sliceTextByWidth } from "@diffr/viewer/terminal/text";
import { Viewer, type KeyPress } from "@diffr/viewer/viewer";
import { litRuns, viewedBox, viewedHint } from "@diffr/viewer/viewport/cell";
import { pickerLines } from "@diffr/viewer/viewport/picker";
/** Pinned to the status line's right end, so cut hints never cut the way to the key list. */
const KEYS_BUTTON = " ? keys ";
/** On the selection bar, which takes the status line while lines are selected. */
const AGENT_BUTTON = " Y Copy for agent ";
const fit = (text: string, width: number) =>
  sliceTextByWidth(text, 0, width).text;
/**
 * A printable key is the character it types: kitty-protocol terminals name the base key ("/"
 * for "?", "9" for "("), and only the sequence carries what was typed. Other keys keep their
 * name, a shifted letter as its capital; cmd counts as meta.
 */
const keyPress = (key: KeyEvent): KeyPress => {
  const modified = key.ctrl || key.meta || key.super === true;
  const typed = !modified && key.sequence !== " " && /^[^\x00-\x1f\x7f]$/u.test(key.sequence) ? key.sequence : undefined;
  return {
    key: typed ?? (key.shift && /^[a-z]$/.test(key.name) ? key.name.toUpperCase() : key.name),
    ctrl: key.ctrl, shift: key.shift, meta: key.meta || key.super === true,
  };
};
export function App({
  store,
  onQuit,
  themes,
}: {
  store: DiffStore;
  onQuit: () => void;
  themes: ThemeSet;
}) {
  const viewer = useMemo(() => new Viewer(store, themes.initial, 100), [store, themes]);
  useSyncExternalStore(viewer.subscribe, viewer.getVersion);
  const renderer = useRenderer(),
    { width, height } = useTerminalDimensions();
  const [showSidebar, setShowSidebar] = useState(true);
  const [selection, setSelection] = useState<SourceSelection | null>(null),
    [message, setMessage] = useState("");
  const [closedDirectories, setClosedDirectories] = useState<Set<string>>(new Set());
  const [treeScroll, setTreeScroll] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(28);
  const sidebarDrag = useRef<{ x: number; width: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const dragging = useRef(false),
    thumbDragging = useRef(false);
  const sidebar = showSidebar && width >= 60 ? Math.max(16, Math.min(sidebarWidth, width - 40)) : 0;
  const contentWidth = Math.max(10, width - sidebar - 1),
    viewportHeight = Math.max(1, height - 3);
  const { snapshot, theme, wrap, hover: hovered, layout, rows, geometry, top, maxScroll, viewport, currentFile, sticky, thumb } =
    viewer.lay({ columns: contentWidth, rows: viewportHeight });
  const [spinner, setSpinner] = useState(0);
  useEffect(() => {
    if (snapshot.complete) return;
    const timer = setInterval(() => setSpinner(n => (n + 1) % 10), 80);
    return () => clearInterval(timer);
  }, [snapshot.complete]);
  const loadingGlyph = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[spinner];
  const { inventory, files, failures } = snapshot;
  // The file's mark in the tree and on its header while it has no diff.
  const statusGlyph = (index: number) => failures[index] || snapshot.complete ? "!" : loadingGlyph;
  const progress = viewer.viewedFiles();
  // While typing, the status line is the prompt; after a search, it leads with where the search stands.
  const found = viewer.searchState();
  const searched = !found || "prompt" in found ? ""
    : `/${found.pattern} · ${found.total ? `match ${found.at} of ${found.total} in ${found.files} files · n/N` : "no matches"} · `;
  const tree = useMemo(() => buildFileTree(inventory), [inventory]);
  const fileOrder = useMemo(() => flattenFileTree(tree, new Set()).flatMap(({node}) =>
    node.fileIndex === undefined ? [] : [node.fileIndex]), [tree]);
  const toggleLayout = () => { viewer.toggleLayout(); setSelection(null); };
  const copy = () => {
    if (!selection) return;
    const text = copySelection(files, rows, selection);
    if (text) {
      renderer.copyToClipboardOSC52(text);
      setMessage("Copied source lines");
    }
  };
  const selected = useMemo(() => (selection ? selectedRanges(files, rows, selection) : []), [files, rows, selection]);
  const copyForAgent = () => {
    if (!selection) return;
    if (!snapshot.comparison) throw new Error("A selection exists before diffr named the comparison");
    const text = agentReference(files, snapshot.comparison, rows, selection);
    if (text) {
      renderer.copyToClipboardOSC52(text);
      setMessage("Copied for agent");
    }
  };
  useKeyboard((key) => {
    // Viewer first, so a pending z chord takes any key.
    const press = keyPress(key), chord = viewer.chording, typing = viewer.prompting;
    if (viewer.press(press)) {
      // s and c reshape the rows, so drop the selection, unless they finish a z chord or go into the prompt.
      if (!chord && !typing && !press.ctrl && !press.meta && (press.key === "s" || press.key === "c")) setSelection(null);
      return;
    }
    // Hunk's chord matcher handles raw control bytes and Kitty events alike.
    const is = (...chords: string[]) => !key.super && chords.some(chord => matchesKey(chord, key));
    if (is("q", "ctrl+c")) onQuit();
    else if ((key.name === "b" && (key.super || key.meta)) || is("\\")) {
      key.preventDefault(); setShowSidebar(v => !v);
    }
    else if (key.name === "y") { if (key.shift) copyForAgent(); else copy(); }
    else if (key.name === "escape") { setSelection(null); setMenu(null); setShowBreakdown(false); }
    else if (key.name === "i") setShowBreakdown((v) => !v);
    else if (press.key === "?") setMenu((m) => (m === "Help" ? null : "Help"));
  });
  const [selectionStart, selectionEnd] = useMemo(
    () => selectionBounds(rows, selection),
    [rows, selection],
  );
  const indices = useMemo(
    () => new Map(rows.map((row, i) => [row.key, i])),
    [rows],
  );
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
    const state = loaded ? viewer.isViewed(fileIndex) : undefined, viewed = state === true;
    // The counts, then the viewed box. A viewed file is read, so its counts go.
    const tally = loaded && !viewed ? [` +${count.added}`, ` −${count.removed}`] : [];
    const box = state === undefined ? "" : ` ${viewedBox(state)}`;
    // While the pointer is on the box, say what a click does beside it.
    const hint = state !== undefined && hovered && "header" in hovered && hovered.file === fileIndex ? ` ${viewedHint(state)}` : "";
    const statsWidth = loaded ? measureTextWidth(tally.join("") + hint + box) + 1 : 0;
    const pathWidth = Math.max(1, contentWidth - statsWidth - 1);
    const glyph = loaded ? (viewer.isClosed(fileIndex, file) ? "▸" : "▾") : statusGlyph(fileIndex);
    const directory = fit(`${glyph} ${path.slice(0, path.lastIndexOf("/") + 1)}`, pathWidth);
    const directoryWidth = measureTextWidth(directory);
    const name = fit(path.slice(path.lastIndexOf("/") + 1), Math.max(0, pathWidth - directoryWidth));
    const lit = viewer.headerLit(fileIndex);
    return <box key={key} height={1} width={contentWidth} flexDirection="row"
      backgroundColor={theme.fileHeader}
      onMouseUp={() => { if (loaded) viewer.toggleFile(fileIndex); }}>
      <text width={1} fg={viewed ? theme.muted : theme.accent} selectable={false}>▌</text>
      <text width={directoryWidth} selectable={false}
        content={styled(litRuns(directory, viewed ? theme.muted : theme.fileHeaderDir, theme.fileHeader, lit, theme))} />
      <text width={Math.max(0, pathWidth - directoryWidth)} selectable={false}
        content={styled(litRuns(name, viewed ? theme.muted : loaded ? theme.fg : theme.fileHeaderDir, theme.fileHeader, lit, theme),
          viewed ? TextAttributes.NONE : TextAttributes.BOLD)} />
      {tally.length > 0 && <>
        <text fg={theme.addedText} selectable={false}>{tally[0]}</text>
        <text fg={theme.removedText} selectable={false}>{tally[1]}</text>
      </>}
      {hint && <>
        <text selectable={false}> </text>
        <text fg={theme.bg} bg={theme.accent} selectable={false}>{hint.slice(1)}</text>
      </>}
      {state !== undefined && <text fg={viewed ? theme.accent : theme.fg} selectable={false}
        onMouseMove={() => viewer.setHover({ file: fileIndex, header: true })}
        onMouseOut={() => viewer.setHover(null)}
        onMouseUp={(event) => { event.stopPropagation(); viewer.toggleViewedFile(fileIndex); }}>{box}</text>}
      {loaded && <text selectable={false}> </text>}
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
              if (row.loadDiff) viewer.toggleFile(row.fileIndex);
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
            focus={hovered?.file === row.fileIndex && "id" in hovered ? hovered : undefined}
            onHover={focus => viewer.setHover(focus ? { file: row.fileIndex, ...focus } : null)}
            onFold={(id, recursive) => viewer.setFold(row.fileIndex, id, "toggle", recursive)}
            read={viewer.isViewed(row.fileIndex) === true}
          />,
        );
    }
  }
  // Reserve a row for the active file header once its original is above the viewport.
  if (currentFile >= 0 && sticky) {
    rendered.unshift(fileHeader(currentFile, "sticky-header"));
  }
  const menuItems: Record<string, [string, () => void][]> = {
    File: [["Toggle file tree  ⌘B / \\", () => setShowSidebar(v => !v)], ["Copy selection  y", copy], ["Quit  q", onQuit]],
    View: [[`Layout: ${layout}  s`, toggleLayout],
      [`Wrap: ${wrap ? "on" : "off"}  w`, () => viewer.toggleWrap()],
      ["Toggle context gaps  c", () => { viewer.toggleContext(); setSelection(null); }],
      ["Fold all  zM", () => viewer.foldAll(true)], ["Unfold all  zR", () => viewer.foldAll(false)]],
    Navigate: [["Previous change  [c", () => viewer.navigateHunk(-1)], ["Next change  ]c", () => viewer.navigateHunk(1)],
      ["First file  Home", () => viewer.scrollTo(0)], ["Last file  End", () => viewer.scrollTo(maxScroll)]],
    Theme: [[`Dark (${themes.dark.name})  t`, () => viewer.setTheme(themes.dark)], [`Light (${themes.light.name})  t`, () => viewer.setTheme(themes.light)]],
    Help: [["Scroll: j/k · h/l · gg/G", () => setMessage("j/k scroll · h/l pan · gg first · G last")],
      ["Half page: Ctrl-D / Ctrl-U", () => setMessage("d / Ctrl-D: half down · u / Ctrl-U: half up")],
      ["Full page: Ctrl-F / Ctrl-B", () => setMessage("Ctrl-F: page down · Ctrl-B: page up")],
      ["Drag to select · y to copy", () => setMessage("Drag source lines; y copies original source")],
      ["Change breakdown  i", () => setShowBreakdown(true)],
      ["Folds: click ▾ · za zo zc · zM zR", () => setMessage("Click the chevron or ⋯ · za toggle, zo open, zc close the top fold (zA zO zC recursive) · zM/zR fold/unfold all · zj/zk next/previous fold")],
      ["Search: / · n N", () => setMessage("/ searches paths and code · n/N next/previous match")],
      ["Go to a file  Ctrl-P / ⌘P", () => viewer.press({ key: "p", ctrl: true })],
      ["Mark the file viewed  V", () => viewer.toggleViewedFile(currentFile)],
      ["Copy for an agent  Y", copyForAgent]],
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
        } else if (thumbDragging.current) viewer.scrub(event.y - 2);
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
          toggleLayout();
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
              viewer.pan(d.direction === "left" ? -4 : 4);
            else
              viewer.move((d.direction === "up" ? -1 : 1) * Math.max(1, d.delta) * 3);
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
                fg={node.fileIndex === currentFile ? theme.accent : node.fileIndex === undefined
                  || viewer.isViewed(node.fileIndex) ? theme.muted : theme.fg}
                bg={node.fileIndex === currentFile ? theme.highlight : theme.bg}
                selectable={false}
                onMouseUp={() => {
                  if (node.fileIndex !== undefined) {
                    setMessage(""); viewer.jump(node.fileIndex);
                  }
                  else setClosedDirectories(old => {
                    const next = new Set(old);
                    if (next.has(node.key)) next.delete(node.key); else next.add(node.key);
                    return next;
                  });
                }}>
                {fit(sanitizeTerminalLine("  ".repeat(depth) + (node.fileIndex === undefined
                  ? (closedDirectories.has(node.key) ? "▸ " : "▾ ")
                  : `▤ ${files[node.fileIndex] ? (viewer.isViewed(node.fileIndex) ? "✓" : " ") : statusGlyph(node.fileIndex)} `) + node.name), sidebar - 1)}
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
              {previousLoaded !== undefined && <text fg={theme.accent} selectable={false} onMouseUp={event => { event.stopPropagation(); viewer.jump(previousLoaded); }}> ↑ previous loaded </text>}
              {nextLoaded !== undefined && <text fg={theme.accent} selectable={false} onMouseUp={event => { event.stopPropagation(); viewer.jump(nextLoaded); }}> ↓ next loaded </text>}
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
            viewer.scrub(event.y - 2);
          }}
          onMouseMove={(event) => {
            if (sidebarDrag.current) {
          setSidebarWidth(resizeSidebarWidth(sidebarDrag.current.width,
            sidebarDrag.current.x, event.x, 16, width - 40));
        } else if (thumbDragging.current) viewer.scrub(event.y - 2);
          }}
        >
          <box
            position="absolute"
            top={thumb.top}
            width={1}
            height={thumb.height}
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
      {(() => {
        // The Ctrl-P picker: up to ten lines over the bottom of the diff, just above the status line.
        const picker = viewer.pickerState();
        if (!picker) return null;
        const drawn = pickerLines(picker, width, Math.min(10, viewportHeight), theme,
          (index) => counts[index]?.visible, (index) => viewer.isViewed(index) === true, "esc close");
        return <box position="absolute" bottom={1} left={0} width={width} height={drawn.length} flexDirection="column" zIndex={10}>
          {drawn.map(({ runs, pick }, i) => <text key={i} height={1} width={width} selectable={false} content={styled(runs)}
            onMouseUp={() => { if (pick !== undefined) viewer.pickFile(pick); }} />)}
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
      {found && "prompt" in found
        ? <text height={1} fg={theme.fg} selectable={false}>{fit(`/${found.prompt}▏ · ${found.count} matches · ⏎ go · esc cancel`, width)}</text>
        : selected.length ? (() => {
          // The selection bar, bright so it catches the eye: what is selected, then the button that copies it for an agent.
          const count = selected.reduce((sum, range) => sum + range.end - range.start + 1, 0);
          const what = selected.length === 1 ? rangeName(selected[0]!) : `${selected.length} files`;
          const lead = fit(` ${message ? `${message} · ` : ""}${what} · ${count} ${count === 1 ? "line" : "lines"} `,
            Math.max(0, width - measureTextWidth(AGENT_BUTTON)));
          const room = width - measureTextWidth(lead) - measureTextWidth(AGENT_BUTTON);
          const hints = " y copy · esc clear";
          return <box height={1} width={width} flexDirection="row" backgroundColor={theme.accent}>
            <text width={measureTextWidth(lead)} fg={theme.bg} bg={theme.accent} attributes={TextAttributes.BOLD} selectable={false}>{lead}</text>
            <text width={measureTextWidth(AGENT_BUTTON)} fg={theme.accent} bg={theme.bg} attributes={TextAttributes.BOLD} selectable={false}
              onMouseUp={copyForAgent}>{AGENT_BUTTON}</text>
            {room > 0 && <text width={room} fg={theme.bg} bg={theme.accent} selectable={false}>
              {measureTextWidth(hints) > room ? `${fit(hints, room - 1)}…` : hints}</text>}
          </box>;
        })()
        : (() => {
          // The hints give way first, cut with an ellipsis; ? keys stays at the right end and opens the Help menu.
          const room = Math.max(1, width - measureTextWidth(KEYS_BUTTON));
          const text = `${message ? `${message} · ` : ""}${searched}${snapshot.loaded}/${inventory.length} files · ${progress.viewed}/${progress.total} viewed ${snapshot.complete ? "" : "loading…"} ${snapshot.errors.length ? `${snapshot.errors.length} errors` : ""}  h/l pan · / search · ctrl-p files · ⌘B tree · V viewed · drag selects lines · y/Y copy · q quit`;
          return <box height={1} width={width} flexDirection="row">
            <text width={room} fg={theme.muted} selectable={false}>{measureTextWidth(text) > room ? `${fit(text, room - 1)}…` : text}</text>
            <text fg={menu === "Help" ? theme.bg : theme.accent} bg={menu === "Help" ? theme.accent : theme.bg} selectable={false}
              onMouseUp={() => setMenu((m) => (m === "Help" ? null : "Help"))}>{KEYS_BUTTON}</text>
          </box>;
        })()}
    </box>
  );
}
