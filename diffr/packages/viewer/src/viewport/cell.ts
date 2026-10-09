import type { Geometry } from "./geometry";
import { foldBackground, type RenderSpan, type SplitLineCell, type UnifiedLineCell } from "../document/rows";
import { measureTextWidth } from "../terminal/text";
import type { RowFold } from "../document/regions";
import { occurrences } from "../document/search";
import type { Palette } from "../theme/palette";

/** The scope the pointer is on. Armed when it points at the scope's rail or chevron, which fold it. */
export interface ScopeFocus {
  id: number;
  armed: boolean;
}

export interface PaintRun {
  text: string;
  fg: string;
  bg: string;
}

export type Target<T> = [from: number, to: number, value: T];

/** Targets are listed most specific first. */
export const targetAt = <T>(targets: readonly Target<T>[], x: number): T | undefined =>
  targets.find(([from, to]) => x >= from && x < to)?.[2];

interface CellPlan {
  bg: string;
  runs: PaintRun[];
  hits: Target<number>[];
  hovers: Target<ScopeFocus>[];
}

export interface CellOptions {
  theme: Palette;
  geometry: Geometry;
  visualLine: number;
  focus?: ScopeFocus;
  selected?: boolean;
  read?: boolean;
}

export interface Lit {
  pattern: string;
  current?: number;
}

/** Lit spans skip the viewed-line fade. */
export function lightMatches(spans: RenderSpan[], lit: Lit, theme: Palette): RenderSpan[] {
  const ranges = occurrences(spans.map((span) => span.text).join(""), lit.pattern);
  if (!ranges.length) return spans;
  const result: RenderSpan[] = [];
  let offset = 0;
  for (const span of spans) {
    const end = offset + span.text.length;
    let cut = offset;
    for (const [nth, [from, to]] of ranges.entries()) {
      if (to <= cut || from >= end) continue;
      const start = Math.max(from, cut), stop = Math.min(to, end), current = nth === lit.current;
      if (start > cut) result.push({ ...span, text: span.text.slice(cut - offset, start - offset) });
      result.push({ ...span, text: span.text.slice(start - offset, stop - offset), lit: true,
        bg: current ? theme.searchCurrent : theme.searchMatch, fg: current ? theme.searchCurrentText : span.fg });
      cut = stop;
    }
    if (cut < end) result.push({ ...span, text: span.text.slice(cut - offset) });
    offset = end;
  }
  return result;
}

export function litRuns(text: string, fg: string, bg: string, lit: Lit | undefined, theme: Palette): PaintRun[] {
  const spans = lit ? lightMatches([{ text, fg, bg }], lit, theme) : [{ text, fg, bg }];
  return spans.map((span) => ({ text: span.text, fg: span.fg ?? fg, bg: span.bg ?? bg }));
}

/** A file header's viewed box, one cell wide in every terminal. */
export const viewedBox = (viewed: boolean) => (viewed ? "[✓]" : "[ ]");

export const viewedHint = (viewed: boolean) => ` ${viewed ? "Unmark viewed" : "Mark as viewed"} · V `;

function chevron(fold: RowFold | undefined) {
  if (!fold) return " ";
  return fold.collapsed ? "▸" : "▾";
}

export function planCell(
  value: SplitLineCell | UnifiedLineCell,
  spans: RenderSpan[],
  width: number,
  unified: boolean,
  { theme, geometry, visualLine, focus, selected = false, read = false }: CellOptions,
): CellPlan {
  const fold = value.fold;
  const washed = focus?.armed && value.body?.includes(focus.id);
  const changed = value.kind === "addition" || value.kind === "deletion";
  const bg = selected ? theme.highlight
    : value.kind === "addition" ? (read ? theme.readAddition : theme.addition)
      : value.kind === "deletion" ? (read ? theme.readDeletion : theme.deletion)
        : washed ? theme.focusWash : theme.bg;
  // A viewed line keeps its shape but drops its colours: muted ink, no word emphasis. Search matches keep theirs.
  if (read && changed) spans = spans.map((span) => (span.lit ? span : { ...span, fg: theme.muted, bg: undefined }));
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
  // A rail or chevron arms its scope to fold; a collapsed fold's chevron or label arms it to open.
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
  if (column < width) runs.push({ text: " ".repeat(width - column), fg: theme.fg, bg });
  // A collapsed fold's row, or a line of its label, opens it.
  const opens = fold?.collapsed ? fold.id : value.labelOf;
  if (opens !== undefined) {
    hits.push([codeColumn, width, opens]);
    hovers.push([codeColumn, width, { id: opens, armed: true }]);
  }
  if (value.scope !== undefined) hovers.push([0, width, { id: value.scope, armed: false }]);
  return { bg, runs, hits, hovers };
}
