import type { Geometry } from "./geometry";
import { foldBackground, type RenderSpan, type SplitLineCell, type UnifiedLineCell } from "../document/rows";
import { measureTextWidth } from "../terminal/text";
import type { RowFold } from "../document/regions";
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
  { theme, geometry, visualLine, focus, selected = false }: CellOptions,
): CellPlan {
  const fold = value.fold;
  const washed = focus?.armed && value.body?.includes(focus.id);
  const bg = selected ? theme.highlight
    : value.kind === "addition" ? theme.addition
      : value.kind === "deletion" ? theme.deletion
        : washed ? theme.focusWash : theme.bg;
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
