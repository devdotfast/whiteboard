/** Plans a code cell's coloured runs and its click and hover targets; frontends draw them. */
import type { Geometry } from "./geometry";
import { foldBackground, type RenderSpan, type SplitLineCell, type UnifiedLineCell } from "../document/rows";
import { measureTextWidth, sliceTextByWidth } from "../terminal/text";
import type { RowFold } from "../document/regions";
import type { Progress } from "../document/viewed";
import type { Palette } from "../theme/palette";

/** The scope the pointer is on. Armed when it points at the scope's rail or chevron, which fold it. */
export interface ScopeFocus {
  id: number;
  armed: boolean;
  /** On the scope's viewed box rather than its code. */
  box?: true;
}

/** What viewed marks change on a cell; `Viewer.cellMarks` works them out. */
export interface CellMarks {
  /** A changed line already viewed: its tint and ink recede. */
  read: boolean;
  /** A collapsed fold whose scope is viewed: its ⋯ reads ✓. */
  foldViewed: boolean;
  /** On the current scope's header line: what's left in the scope, and its box. */
  box?: Progress;
  /** The pointer is on the box: say what a click does beside it. */
  hint?: boolean;
}

/** One cell wide in every terminal: unread, partly viewed, viewed. */
export const viewedBox = (progress: Progress) =>
  progress.state === "viewed" ? "[✓]" : progress.state === "partial" ? "[-]" : "[ ]";

/** What a click on a viewed box does, and the key that does the same; shown beside the box. */
export const viewedHint = (progress: Progress, key: "v" | "V") =>
  ` ${progress.state === "viewed" ? "Unmark viewed" : "Mark as viewed"} · ${key} `;

/** Runs cut to `width` cells. */
function clip(runs: PaintRun[], width: number): PaintRun[] {
  const result: PaintRun[] = [];
  let room = width;
  for (const run of runs) {
    if (room <= 0) break;
    const cells = measureTextWidth(run.text);
    result.push(cells <= room ? run : { ...run, text: sliceTextByWidth(run.text, 0, room).text });
    room -= cells;
  }
  return result;
}

export interface PaintRun {
  text: string;
  fg: string;
  bg: string;
}

/** Half-open columns from the cell's left edge. */
export type Target<T> = [from: number, to: number, value: T];

/** Targets are listed most specific first. */
export const targetAt = <T>(targets: readonly Target<T>[], x: number): T | undefined =>
  targets.find(([from, to]) => x >= from && x < to)?.[2];

export interface CellPlan {
  bg: string;
  /** Exactly the cell's width. */
  runs: PaintRun[];
  /** The fold-state id a click toggles. */
  hits: Target<number>[];
  hovers: Target<ScopeFocus>[];
  /** The viewed box: a click marks or unmarks this fold-state id. Checked before `hits`. */
  marks: Target<number>[];
}

export interface CellOptions {
  theme: Palette;
  geometry: Geometry;
  /** Which wrapped line of the row this is; only the first carries numbers and the chevron. */
  visualLine: number;
  focus?: ScopeFocus;
  selected?: boolean;
  marks?: CellMarks;
}

function chevron(fold: RowFold | undefined) {
  if (!fold) return " ";
  return fold.collapsed ? "▸" : "▾";
}

export function planCell(
  value: SplitLineCell | UnifiedLineCell,
  spans: RenderSpan[],
  width: number,
  unified: boolean,
  { theme, geometry, visualLine, focus, selected = false, marks }: CellOptions,
): CellPlan {
  const fold = value.fold;
  const washed = focus?.armed && value.body?.includes(focus.id);
  const read = marks?.read ?? false;
  const bg = selected ? theme.highlight
    : value.kind === "addition" ? (read ? theme.readAddition : theme.addition)
      : value.kind === "deletion" ? (read ? theme.readDeletion : theme.deletion)
        : washed ? theme.focusWash : theme.bg;
  // A viewed line keeps its shape but drops its colours: muted ink, no word emphasis.
  if (read) spans = spans.map((span) => ({ ...span, fg: theme.muted, bg: undefined }));
  // A viewed fold says so where it says what it hides: its ⋯ becomes an accent ✓.
  if (marks?.foldViewed) {
    const at = spans.findIndex((span) => span.text.includes("⋯"));
    if (at >= 0) {
      const span = spans[at]!, cut = span.text.indexOf("⋯");
      spans = [...spans.slice(0, at), { ...span, text: span.text.slice(0, cut) },
        { ...span, text: "✓", fg: theme.accent }, { ...span, text: span.text.slice(cut + 1) }, ...spans.slice(at + 1)];
    }
  }
  // The current scope's header ends in what's left to read in it and its box.
  const suffix: PaintRun[] = [];
  if (marks?.box && !visualLine) {
    const { remaining, state } = marks.box;
    const parts: [string, string][] = [];
    if (remaining.added) parts.push([`+${remaining.added}`, theme.addedText]);
    if (remaining.removed) parts.push([`−${remaining.removed}`, theme.removedText]);
    for (const [text, fg] of parts) suffix.push({ text: " ", fg, bg }, { text, fg, bg });
    // The hint goes before the box, so the box stays under the pointer.
    if (marks.hint) suffix.push({ text: " ", fg: theme.fg, bg }, { text: viewedHint(marks.box, "v"), fg: theme.bg, bg: theme.accent });
    suffix.push({ text: " ", fg: theme.fg, bg },
      { text: viewedBox(marks.box), fg: state === "unread" ? theme.fg : theme.accent, bg }, { text: " ", fg: theme.fg, bg });
  }
  const suffixWidth = suffix.reduce((n, run) => n + measureTextWidth(run.text), 0);
  const limit = Math.max(0, width - suffixWidth);
  // Row colours carry addition and deletion, so the gutter holds numbers and the chevron only.
  const digits = geometry.gutter - 4;
  const number = (n: number | undefined) => `${visualLine ? "" : (n ?? "")}`.padStart(digits);
  const numbers = unified
    ? ` ${number((value as UnifiedLineCell).oldLineNumber)} ${number((value as UnifiedLineCell).newLineNumber)} `
    : ` ${number("lineNumber" in value ? value.lineNumber : undefined)} `;
  const gutterWidth = unified ? geometry.unifiedGutter : geometry.gutter;
  const available = Math.max(1, width - gutterWidth);
  const used = Math.min(available, spans.reduce((n, s) => n + measureTextWidth(s.text), 0));
  // A collapsed row's tint fills the rest of the line; its header row also draws a ┄ rule to
  // the edge, so a fold reads as a seam in the code rather than a band like a file header.
  const rest = available - used;
  const painted = value.band && rest > 0
    ? [...spans, { text: (value.fold ? "  " + "┄".repeat(rest) : " ".repeat(rest)).slice(0, rest),
        fg: theme.guide, bg: foldBackground(theme, value.band) }] : spans;
  // Open chevrons rest faint so they don't compete with the code; a collapsed one stays
  // legible, since it is the way back in, and the focused scope's lights up, open or not.
  const chevronFg = fold && fold.id === focus?.id ? theme.accent
    : fold?.collapsed ? theme.muted : theme.guide;
  const chevronColumn = numbers.length, codeColumn = chevronColumn + 2;
  const runs: PaintRun[] = [
    { text: numbers, fg: theme.muted, bg },
    { text: visualLine ? " " : chevron(fold), fg: chevronFg, bg },
    { text: " ", fg: theme.fg, bg },
  ];
  const hits: Target<number>[] = [], hovers: Target<ScopeFocus>[] = [];
  // What the pointer is on. A rail or the chevron arms its scope, so a click folds it, and a
  // collapsed fold's chevron or label arms that fold, so a click opens it; anywhere else on the
  // row reads the innermost scope around the line.
  if (fold && !visualLine) {
    hits.push([chevronColumn, chevronColumn + 1, fold.id]);
    hovers.push([chevronColumn, chevronColumn + 1, { id: fold.id, armed: true }]);
  }
  let column = codeColumn;
  for (const span of painted) {
    const rail = span.guide !== undefined && span.guide === focus?.id;
    const brace = span.brace !== undefined && span.brace === focus?.id;
    const text = rail && focus!.armed ? span.text.replace(/│/g, "┃") : span.text;
    const cells = measureTextWidth(text);
    runs.push({
      text,
      fg: rail || brace ? theme.accent : span.fg ?? theme.fg,
      bg: brace && focus!.armed ? theme.focusBrace : selected ? bg : span.bg ?? bg,
    });
    if (span.guide !== undefined) {
      hits.push([column, column + cells, span.guide]);
      hovers.push([column, column + cells, { id: span.guide, armed: true }]);
    }
    column += cells;
  }
  const fitted = clip(runs, limit);
  if (column < limit) fitted.push({ text: " ".repeat(limit - column), fg: theme.fg, bg });
  fitted.push(...suffix);
  // A collapsed fold's row, or a line of its label, opens it.
  const opens = fold?.collapsed ? fold.id : value.labelOf;
  if (opens !== undefined) {
    hits.push([codeColumn, width, opens]);
    hovers.push([codeColumn, width, { id: opens, armed: true }]);
  }
  if (value.scope !== undefined) hovers.push([0, width, { id: value.scope, armed: false }]);
  const boxes: Target<number>[] = suffix.length && fold ? [[limit, width, fold.id]] : [];
  return { bg, runs: fitted, hits, hovers, marks: boxes };
}
