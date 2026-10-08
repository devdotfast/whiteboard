/** Project diffr's per-side region trees into terminal cells by zipping leaves on their ids. */
import type { DiffFile, Span, SyntaxSpan } from "../protocol/wire";
import { filePath } from "../protocol/wire";
import { sliceSpansWindow } from "../terminal/spans";
import { measureTextWidth } from "../terminal/text";
import { byteColumn, collapsedFolds, flatten, foldHeaders, foldTint, hiddenLines, pairedIds, sourceLines, type Fold, type FoldTint, type Leaf, type RowFold, type Side } from "./regions";
import { foldBackground, type Palette } from "../theme/palette";
export { sourceLines };
export type Layout = "split" | "unified";
export interface RenderSpan {
  text: string;
  /** Fold-state id of an indent guide; paint-only hover accent. */
  guide?: number;
  /** Fold-state id of the scope whose opening or closing bracket this is. */
  brace?: number;
  fg?: string;
  bg?: string;
  /** Resolve paint-only foreground effects after cursor and copy-selection backgrounds apply. */
  transformFg?: (sourceFg: string | undefined, renderedBg: string) => string;
}

export interface SplitLineCell {
  kind: "context" | "addition" | "deletion" | "empty";
  sign: string;
  lineNumber?: number;
  /** This cell starts a fold region; the chevron and placeholder come from here. */
  fold?: RowFold;
  /** A line of a collapsed fold's label, painted in the fold tint without a line number. */
  foldLabel?: boolean;
  /** On a label line, its fold's fold-state id: a click opens that fold. */
  labelOf?: number;
  /** A collapsed row or label line: its tint fills the rest of the line. */
  band?: FoldTint;
  /** The innermost open scope holding this line, its opener and closer included. */
  scope?: number;
  /** Open scopes whose body (between opener and closer) holds this line. */
  body?: number[];
  spans: RenderSpan[];
}

export interface UnifiedLineCell {
  kind: "context" | "addition" | "deletion";
  sign: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  fold?: RowFold;
  foldLabel?: boolean;
  labelOf?: number;
  band?: FoldTint;
  scope?: number;
  body?: number[];
  spans: RenderSpan[];
}
export interface ViewerRow {
  key: string;
  fileIndex: number;
  /** First row of a run of changed rows, for `[` and `]`. */
  hunkStart?: boolean;
  label?: string;
  /** A hidden-file placeholder: "Load diff" reveals the file. */
  loadDiff?: boolean;
  pending?: boolean;
  left?: SplitLineCell;
  right?: SplitLineCell;
  cell?: UnifiedLineCell;
}
/** Foreground for a tree-sitter capture: the theme's scope, its parents, else plain text. */
export function captureColor(capture: string, theme: Palette): string {
  return theme.syntax(capture) ?? theme.fg;
}
/** Colour a line from byte-addressed syntax and change spans, then expand tabs into cells. */
export function lineSpans(
  text: string,
  syntax: SyntaxSpan[],
  changed: Span[],
  side: "left" | "right",
  theme: Palette,
): RenderSpan[] {
  const bytes = new TextEncoder().encode(text),
    decoder = new TextDecoder("utf-8", { fatal: true });
  const bounds = new Set([0, bytes.length]);
  for (const span of [...syntax, ...changed]) {
    bounds.add(span.start_column);
    bounds.add(span.end_column);
  }
  const sorted = [...bounds].sort((a, b) => a - b);
  const wordBg = side === "left" ? theme.deleteWord : theme.addWord;
  const spans: RenderSpan[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const start = sorted[i], end = sorted[i + 1];
    // Innermost syntax capture wins, so pick the narrowest span covering this segment.
    const capture = syntax
      .filter((s) => s.start_column <= start && s.end_column >= end)
      .sort((a, b) => a.end_column - a.start_column - (b.end_column - b.start_column))[0];
    const emphasized = changed.some((s) => s.start_column <= start && s.end_column >= end);
    spans.push({
      text: decoder.decode(bytes.slice(start, end)),
      fg: capture ? captureColor(capture.capture, theme) : theme.fg,
      bg: emphasized ? wordBg : undefined,
    });
  }
  let column = 0;
  return spans.map((span) => ({
    ...span,
    text: span.text
      .split("\t")
      .map((part, index) => {
        const padding = index ? " ".repeat(4 - (column % 4)) : "";
        column += padding.length + measureTextWidth(part);
        return padding + part;
      })
      .join(""),
  }));
}
type SyntaxFold = Fold & { syntax: NonNullable<Fold["syntax"]> };
const empty: SplitLineCell = { kind: "empty", sign: " ", spans: [] };
function byLine(spans: SyntaxSpan[]) {
  const result = new Map<number, SyntaxSpan[]>();
  for (const span of spans) result.set(span.line, [...(result.get(span.line) ?? []), span]);
  return result;
}
/** Rows for a hidden file: GitHub's "Load diff" placeholder under the header. */
export function placeholderRows(fileIndex: number, label: string): ViewerRow[] {
  return [
    { key: `${fileIndex}:load`, fileIndex, label: "Load diff", loadDiff: true },
    { key: `${fileIndex}:why`, fileIndex, label: label || "Hidden by default" },
  ];
}
/** Render both sides by zipping leaves on their ids; folding never realigns. */
export function rowsForFile(
  file: DiffFile,
  fileIndex: number,
  layout: Layout,
  theme: Palette,
  collapsed: ReadonlySet<number> = new Set(),
): ViewerRow[] {
  const d = file.diff;
  const rows: ViewerRow[] = [{ key: `${fileIndex}:header`, fileIndex, label: filePath(file.file) }];
  if (d.type === "binary")
    return [...rows, { key: `${fileIndex}:binary`, fileIndex, label: "Binary file" }];
  const texts = [sourceLines(d.lhs?.text ?? ""), sourceLines(d.rhs?.text ?? "")];
  const syntax = [byLine(d.lhs?.syntax ?? []), byLine(d.rhs?.syntax ?? [])];
  const { leaves, folds } = flatten(d);
  const hidden = [hiddenLines(folds[0], collapsed), hiddenLines(folds[1], collapsed)];
  // A collapsed fold is a row of its own, where its first line would have been. A syntax fold
  // with a one-line label instead joins its opener, label and closing suffix on the opener's
  // line, so its closer is masked too.
  const bands = folds.map(side => collapsedFolds(side, collapsed));
  // A syntax fold with a multi-line label shows it between its opener and closer lines.
  const quoted = bands.map((sideBands) => {
    const result = new Map<number, SyntaxFold>();
    for (const fold of sideBands.values())
      if (fold.syntax && fold.label.includes("\n") && fold.syntax.start.line < fold.startLine)
        result.set(fold.syntax.start.line, fold as SyntaxFold);
    return result;
  });
  const isQuoted = (region: Leaf | Fold): region is SyntaxFold => quoted[region.side].get((region as Fold).syntax?.start.line ?? -1) === region;
  const inline = bands.map((sideBands, side) => {
    const result = new Map<number, SyntaxFold>();
    for (const fold of sideBands.values()) {
      if (!fold.syntax || fold.label.includes("\n")) continue;
      sideBands.delete(fold.startLine);
      result.set(fold.syntax.start.line, fold as SyntaxFold);
      for (let line = fold.syntax.start.line + 1; line <= fold.syntax.end.line; line++) hidden[side].add(line);
    }
    return result;
  });
  const paired = pairedIds(d);
  const headers = [foldHeaders(folds[0], leaves[0], collapsed, paired[0]), foldHeaders(folds[1], leaves[1], collapsed, paired[1])];
  // An open syntax fold draws a guide down every line after its opener, at the indent of the
  // opener's line.
  const guides = folds.map((side, index) => {
    const lines = new Map<number, Guide[]>();
    for (const fold of side) {
      if (!fold.syntax || collapsed.has(fold.foldStateId)) continue;
      const opener = texts[index][fold.syntax.start.line]!;
      const column = byteColumn(opener, opener.length - opener.trimStart().length);
      for (let line = fold.syntax.start.line + 1; line <= fold.syntax.end.line; line++)
        lines.set(line, [...(lines.get(line) ?? []), { column, id: fold.foldStateId }]);
    }
    return lines;
  });
  // An open scope is a syntax fold on screen, whose rail, brackets and chevron are one target.
  // The pointer anywhere from its opener's line to its closer's focuses the innermost one; its
  // body is the lines between, which folding it hides.
  const scopes = folds.map((side) => {
    const lines = new Map<number, SyntaxFold[]>();
    for (const fold of side) {
      if (!fold.syntax || collapsed.has(fold.foldStateId)) continue;
      for (let line = fold.syntax.start.line; line <= fold.syntax.end.line; line++)
        lines.set(line, [...(lines.get(line) ?? []), fold as SyntaxFold]);
    }
    return lines;
  });
  const scopeOf = (side: Side, line: number) => {
    const around = scopes[side].get(line) ?? [];
    const extent = (fold: SyntaxFold) => fold.syntax.end.line - fold.syntax.start.line;
    // Two scopes can share their lines, as `({` does: the one opening later is inside.
    const inner = around.reduce<SyntaxFold | undefined>((best, fold) => !best || extent(fold) < extent(best)
      || (extent(fold) === extent(best) && fold.syntax.start.column > best.syntax.start.column) ? fold : best, undefined);
    return { scope: inner?.foldStateId,
      body: around.filter(fold => fold.syntax.start.line < line && line < fold.syntax.end.line).map(fold => fold.foldStateId) };
  };
  // The opener is the byte before a scope's syntax range and the closer the byte at its end.
  // Quoted folds keep their brackets on the visible opener and closer.
  const quotedEnds = quoted.map((side) => {
    const lines = new Map<number, SyntaxFold[]>();
    for (const fold of side.values())
      for (const line of [fold.syntax.start.line, fold.syntax.end.line]) lines.set(line, [...(lines.get(line) ?? []), fold]);
    return lines;
  });
  const withBraces = (spans: RenderSpan[], side: Side, line: number) => {
    let result = spans;
    for (const fold of [...(scopes[side].get(line) ?? []), ...(quotedEnds[side].get(line) ?? [])]) {
      const { start, end } = fold.syntax, text = texts[side][line]!;
      if (start.line === line && start.column > 0) result = markBrace(result, byteColumn(text, start.column - 1), fold.foldStateId);
      if (end.line === line) result = markBrace(result, byteColumn(text, end.column), fold.foldStateId);
    }
    return result;
  };
  const tintOf = (region: Leaf | Fold) => foldTint(region.id, region.side, paired[region.side]);
  // What a collapsed region says it hides: diffr's label, else how many lines it covers, so a
  // fold no plugin labelled still reads `{ ⋯ 3 lines }` rather than a bare `{ ⋯ }`.
  const labelOf = (region: Leaf | Fold) => region.label
    || lineCount("lastHidden" in region ? region.lastHidden - region.startLine + 1 : region.endLine - region.startLine);
  const alignments = leaves.map(side => new Set(side.map(leaf => leaf.alignmentId)));
  const isChanged = (leaf: Leaf, line: number) =>
    leaf.changed.has(line) || !alignments[leaf.side ? 0 : 1].has(leaf.alignmentId);
  // A paired leaf is changed when its counterpart has change spans.
  const spanned = new Set(leaves.flat().filter(leaf => leaf.changed.size).map(leaf => leaf.alignmentId));
  // A collapsed paired region that hides a change is modified, and counts its side's changed lines.
  const collapsedTint = (region: Leaf | Fold): { tint: FoldTint; note: string } => {
    const tint = tintOf(region);
    if (tint !== "neutral") return { tint, note: "" };
    const last = "lastHidden" in region ? region.lastHidden : region.endLine - 1;
    const inside = leaves[region.side].filter(leaf => leaf.endLine > region.startLine && leaf.startLine <= last);
    let count = 0;
    for (const leaf of inside)
      for (let line = Math.max(leaf.startLine, region.startLine); line <= Math.min(leaf.endLine - 1, last); line++)
        if (isChanged(leaf, line)) count++;
    if (!count && !inside.some(leaf => spanned.has(leaf.alignmentId))) return { tint, note: "" };
    return { tint: "modified", note: count ? ` · ${lineCount(count)} changed` : "" };
  };
  const placeholder = (text: string, tint: FoldTint): RenderSpan =>
    ({ text, fg: theme.foldPlaceholder, bg: foldBackground(theme, tint) });
  const caches = [new Map<number, RenderSpan[]>(), new Map<number, RenderSpan[]>()];
  const spansOf = (side: Side, line: number, leaf: Leaf) => {
    let spans = caches[side].get(line);
    if (!spans) {
      spans = lineSpans(texts[side][line]!, syntax[side].get(line) ?? [], leaf.changed.get(line) ?? [],
        side ? "right" : "left", theme);
      caches[side].set(line, spans);
    }
    return spans;
  };
  const cell = (leaf: Leaf | null, line: number | null, side: Side): SplitLineCell => {
    if (line === null || leaf === null) return empty;
    let spans = withBraces(spansOf(side, line, leaf), side, line);
    let fold = headers[side].get(line);
    const opens = quoted[side].get(line);
    if (opens) fold = { id: opens.foldStateId, label: opens.label, collapsed: true, tint: collapsedTint(opens).tint };
    const folded = inline[side].get(line);
    if (folded) {
      const { start, end } = folded.syntax;
      const closer = texts[side][end.line]!;
      const suffix = lineSpans(closer, syntax[side].get(end.line) ?? [], [], side ? "right" : "left", theme);
      const label = labelOf(folded).replace(/\n/g, " · ");
      const { tint, note } = collapsedTint(folded);
      spans = [...sliceSpansWindow(spans, 0, byteColumn(texts[side][line]!, start.column)).spans,
        placeholder(` ⋯ ${label}${note} `, tint),
        ...sliceSpansWindow(suffix, byteColumn(closer, end.column), Infinity).spans];
      fold = { id: folded.foldStateId, label: folded.label, collapsed: true, tint };
    }
    const changed = isChanged(leaf, line);
    return {
      kind: changed ? (side ? "addition" : "deletion") : "context",
      sign: changed ? (side ? "+" : "-") : " ",
      lineNumber: line + 1,
      spans: withGuides(spans, guides[side].get(line) ?? [], theme),
      fold,
      ...scopeOf(side, line),
    };
  };
  let pendingOld: ViewerRow[] = [], pendingNew: ViewerRow[] = [];
  const flush = () => {
    rows.push(...pendingOld, ...pendingNew);
    pendingOld = [];
    pendingNew = [];
  };
  // A collapsed region is one row: chevron and label, no line number, whether the region is a
  // fold or a leaf the context plugin cut out. It starts at its parent's indent; a multi-line
  // label (pseudocode) hangs under it at that indent, one row per line. A syntax body with a
  // multi-line label is instead quoted between its opener and closer, at the body's indent beside
  // the scope's rail.
  const band = (region: Leaf | Fold) => {
    const { tint, note } = collapsedTint(region);
    const multiline = region.label.includes("\n");
    const body = texts[region.side][region.startLine]!;
    const enclosing = guides[region.side].get(region.startLine) ?? [];
    const label = { kind: "context" as const, sign: " ", band: tint, foldLabel: true, labelOf: region.foldStateId,
      ...scopeOf(region.side, region.startLine) };
    if (isQuoted(region)) {
      const opener = texts[region.side][region.syntax.start.line]!;
      const rail = { column: byteColumn(opener, opener.length - opener.trimStart().length), id: region.foldStateId };
      const lead = (text: string) => withGuides([{ text: " ".repeat(byteColumn(body, body.length - body.trimStart().length)) },
        placeholder(text, tint)], [...enclosing, rail], theme);
      const [header, ...labels] = region.label.split("\n").map((text, i) => ({ ...label, spans: lead(i ? text : `${text}${note}`) }));
      return { header: header!, labels };
    }
    const lead = (text: string) => withGuides([{ text: " ".repeat(region.parentColumn) }, placeholder(text, tint)], enclosing, theme);
    const header = { kind: "context" as const, sign: " ", band: tint,
      spans: lead(`⋯${multiline ? "" : " " + labelOf(region)}${note}`),
      fold: { id: region.foldStateId, label: region.label, collapsed: true, tint }, ...scopeOf(region.side, region.startLine) };
    const labels = multiline ? region.label.split("\n").map(text => ({ ...label, spans: lead(text) })) : [];
    return { header, labels };
  };
  const collapsedRow = (kind: string, leftRegion: Leaf | Fold | null, rightRegion: Leaf | Fold | null) => {
    flush();
    const key = `${fileIndex}:${kind}:${(leftRegion ?? rightRegion)!.id}`;
    const left = leftRegion && band(leftRegion), right = rightRegion && band(rightRegion);
    if (layout === "unified") {
      const shown = (right ?? left)!;
      rows.push({ key, fileIndex, cell: shown.header });
      shown.labels.forEach((cell, i) => rows.push({ key: `${key}:label:${i}`, fileIndex, cell }));
      return;
    }
    rows.push({ key, fileIndex, left: left?.header ?? empty, right: right?.header ?? empty });
    for (let i = 0; i < Math.max(left?.labels.length ?? 0, right?.labels.length ?? 0); i++)
      rows.push({ key: `${key}:label:${i}`, fileIndex, left: left?.labels[i] ?? empty, right: right?.labels[i] ?? empty });
  };
  const emit = (l: number | null, r: number | null, left: Leaf | null, right: Leaf | null) => {
    const key = `${fileIndex}:${l ?? "_"}:${r ?? "_"}`;
    // A side's line is folded away, as a hidden line or a collapsed leaf, rather than absent.
    const folded = (line: number | null, leaf: Leaf | null, side: Side) =>
      line === null ? leaf !== null && collapsed.has(leaf.foldStateId) : hidden[side].has(line);
    const [leftFolded, rightFolded] = [folded(l, left, 0), folded(r, right, 1)];
    if (leftFolded) l = null;
    if (rightFolded) r = null;
    if (l === null && r === null) return;
    const a = cell(left, l, 0), b = cell(right, r, 1);
    if (layout === "split") {
      rows.push({ key, fileIndex, left: a, right: b });
      return;
    }
    // Correspondence and novelty come from diffr, including formatting-only changes.
    if (l !== null && r !== null && a.kind === "context" && b.kind === "context") {
      flush();
      rows.push({ key, fileIndex, cell: { kind: "context", sign: " ", oldLineNumber: l + 1,
        newLineNumber: r + 1, fold: b.fold ?? a.fold, scope: b.scope, body: b.body, spans: b.spans } });
      return;
    }
    // A row with one line number is gone from, or new to, the other side even when diffr found
    // no changed words in it, as when a line was split; it keeps its kind only when the other
    // side's line is folded away.
    if (l !== null) {
      const removed = a.kind === "deletion" || !rightFolded;
      pendingOld.push({ key: `${key}:old`, fileIndex, cell: { kind: removed ? "deletion" : "context",
        sign: removed ? "-" : " ", oldLineNumber: l + 1, fold: a.fold, scope: a.scope, body: a.body, spans: a.spans } });
    }
    if (r !== null) {
      const added = b.kind === "addition" || !leftFolded;
      pendingNew.push({ key: `${key}:new`, fileIndex, cell: { kind: added ? "addition" : "context",
        sign: added ? "+" : " ", newLineNumber: r + 1, fold: b.fold, scope: b.scope, body: b.body, spans: b.spans } });
    }
  };
  const leafRows = (left: Leaf | null, right: Leaf | null) => {
    // Every leaf is split at its folds' edges, so a fold's first line is a leaf's: the fold's
    // row goes here, before the leaf it would have started.
    const leftFold = left && bands[0].get(left.startLine), rightFold = right && bands[1].get(right.startLine);
    if (leftFold || rightFold) collapsedRow("fold", leftFold ?? null, rightFold ?? null);
    // A collapsed leaf is masked on its own side only, so the other side keeps its rows.
    const leftGap = left && collapsed.has(left.foldStateId) ? left : null;
    const rightGap = right && collapsed.has(right.foldStateId) ? right : null;
    // A gap inside a collapsed fold has no row of its own.
    const shown = (gap: Leaf | null, side: Side) => gap && !hidden[side].has(gap.startLine) ? gap : null;
    if (shown(leftGap, 0) || shown(rightGap, 1)) collapsedRow("gap", shown(leftGap, 0), shown(rightGap, 1));
    const leftLines = left && !leftGap ? left.endLine - left.startLine : 0;
    const rightLines = right && !rightGap ? right.endLine - right.startLine : 0;
    for (let i = 0; i < Math.max(leftLines, rightLines); i++)
      emit(i < leftLines ? left!.startLine + i : null, i < rightLines ? right!.startLine + i : null, left, right);
  };
  // Zip: walk the left leaves; a partner ahead on the right flushes what precedes it as right-only.
  // diffr sends paired leaves in the same order on both sides.
  const rightIndex = new Map(leaves[1].map((leaf, index) => [leaf.alignmentId, index]));
  let cursor = 0;
  const flushRight = (until: number) => {
    for (; cursor < until; cursor++) leafRows(null, leaves[1][cursor]);
  };
  for (const left of leaves[0]) {
    const partner = rightIndex.get(left.alignmentId);
    if (partner === undefined) {
      leafRows(left, null);
      continue;
    }
    flushRight(partner);
    leafRows(left, leaves[1][partner]);
    cursor = partner + 1;
  }
  flushRight(leaves[1].length);
  flush();
  return markHunks(rows);
}
function markHunks(rows: ViewerRow[]): ViewerRow[] {
  let inHunk = false;
  for (const row of rows) {
    const changed = row.cell
      ? row.cell.kind !== "context"
      : row.left !== undefined && (row.left.kind !== "context" || row.right!.kind !== "context");
    if (changed && !inHunk) row.hunkStart = true;
    inHunk = changed;
  }
  return rows;
}
const lineCount = (count: number) => `${count} line${count === 1 ? "" : "s"}`;
/** Tag the one cell at a terminal column as a scope's bracket. */
function markBrace(spans: RenderSpan[], column: number, id: number): RenderSpan[] {
  const at = sliceSpansWindow(spans, column, 1).spans;
  if (!at.length) return spans;
  return [...sliceSpansWindow(spans, 0, column).spans, ...at.map(span => ({ ...span, brace: id })),
    ...sliceSpansWindow(spans, column + 1, Infinity).spans];
}
/** Replace only whitespace with guides. Blank source lines still carry their enclosing scopes. */
interface Guide {
  column: number;
  /** The fold-state id of the fold the guide belongs to. */
  id: number;
}
function withGuides(spans: RenderSpan[], guides: Guide[], theme: Palette): RenderSpan[] {
  let result = spans;
  for (const { column, id } of guides) {
    const text = result.map(s => s.text).join("");
    const width = measureTextWidth(text);
    if (width <= column) result = [...result, { text: " ".repeat(column + 1 - width) }];
    const at = sliceSpansWindow(result, column, 1).spans;
    if (!at.every(s => /^\s*$/.test(s.text))) continue;
    result = [...sliceSpansWindow(result, 0, column).spans,
      { text: "│", fg: theme.guide, guide: id },
      ...sliceSpansWindow(result, column + 1, Infinity).spans];
  }
  return result;
}
