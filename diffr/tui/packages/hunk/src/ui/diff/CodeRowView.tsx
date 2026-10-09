/** Paint measured Hunk-style code cells; source identity and viewport geometry stay outside React. */
import { memo } from "react";
import { StyledText, parseColor, type MouseEvent } from "@opentui/core";
import type {
  RenderSpan,
  ScopeFocus,
  SplitLineCell,
  UnifiedLineCell,
} from "./diffRowModel";
import type { Geometry, MeasuredRow } from "../../diffr/geometry";
import { foldBackground, type Palette } from "../../diffr/palette";
import type { RowFold } from "../../diffr/regions";
import { measureTextWidth } from "../lib/text";
const colors = new Map<string, ReturnType<typeof parseColor>>();
function color(value: string) {
  let c = colors.get(value);
  if (!c) {
    c = parseColor(value);
    colors.set(value, c);
  }
  return c;
}
/** The focused scope's rail and brackets take the accent; armed, the rail thickens and the
 * brackets get the bracket-match box. */
function styled(spans: RenderSpan[], theme: Palette, bg: string, focus?: ScopeFocus) {
  return new StyledText(
    spans.map((span) => {
      const rail = span.guide !== undefined && span.guide === focus?.id;
      const brace = span.brace !== undefined && span.brace === focus?.id;
      return {
        __isChunk: true as const,
        text: rail && focus!.armed ? span.text.replace(/│/g, "┃") : span.text,
        fg: color(rail || brace ? theme.accent : span.fg ?? theme.fg),
        bg: color(brace && focus!.armed ? theme.focusBrace : span.bg ?? bg),
      };
    }),
  );
}
function chevron(fold: RowFold | undefined) {
  if (!fold) return " ";
  return fold.collapsed ? "▸" : "▾";
}
/** The rail under a terminal column of a row's spans, if any. */
function railAt(spans: RenderSpan[], column: number): number | undefined {
  let at = 0;
  for (const span of spans) {
    const width = measureTextWidth(span.text);
    if (column < at + width) return span.guide;
    at += width;
  }
  return undefined;
}
export const CodeRowView = memo(function CodeRowView({
  measured,
  visualLine,
  geometry,
  theme,
  selectedSide,
  onSelect,
  onExtend,
  onFold,
  focus,
  onHover,
}: {
  measured: MeasuredRow;
  visualLine: number;
  geometry: Geometry;
  theme: Palette;
  selectedSide?: "left" | "right";
  onSelect: (side: "left" | "right") => void;
  onExtend: () => void;
  focus?: ScopeFocus;
  onHover: (focus: ScopeFocus | undefined) => void;
  onFold: (id: number, recursive: boolean) => void;
}) {
  const row = measured.row;
  function cell(
    value: SplitLineCell | UnifiedLineCell,
    spans: RenderSpan[],
    width: number,
    side: "left" | "right",
    unified = false,
  ) {
    const fold = value.fold;
    const washed = focus?.armed && value.body?.includes(focus.id);
    const bg =
      selectedSide === side
        ? theme.highlight
        : value.kind === "addition"
            ? theme.addition
            : value.kind === "deletion"
              ? theme.deletion
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
      ? [...spans, {text: (value.fold ? "  " + "┄".repeat(rest) : " ".repeat(rest)).slice(0, rest),
          fg: theme.guide, bg: foldBackground(theme, value.band)}] : spans;
    // What the pointer is on. A rail or the chevron arms its scope, so a click folds it, and a
    // collapsed fold's chevron or label arms that fold, so a click opens it; anywhere else on the
    // row reads the innermost scope around the line.
    const chevronColumn = numbers.length, codeColumn = numbers.length + 2;
    const opens = fold?.collapsed ? fold.id : value.labelOf;
    const rail = (event: MouseEvent) => {
      const column = event.x - (event.currentTarget?.x ?? 0);
      return column >= codeColumn ? railAt(painted, column - codeColumn) : undefined;
    };
    const target = (event: MouseEvent): ScopeFocus | undefined => {
      const column = event.x - (event.currentTarget?.x ?? 0);
      const id = column === chevronColumn && fold && !visualLine ? fold.id
        : rail(event) ?? (column >= codeColumn ? opens : undefined);
      if (id !== undefined) return { id, armed: true };
      return value.scope === undefined ? undefined : { id: value.scope, armed: false };
    };
    // Open chevrons rest faint so they don't compete with the code; a collapsed one stays
    // legible, since it is the way back in, and the focused scope's lights up, open or not.
    const chevronFg = fold && fold.id === focus?.id ? theme.accent
      : fold?.collapsed ? theme.muted : theme.guide;
    return (
      <box
        width={width}
        height={1}
        flexDirection="row"
        backgroundColor={bg}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if (rail(event) !== undefined) event.stopPropagation();
          else onSelect(side);
        }}
        onMouseUp={(event) => {
          const id = event.button === 0 ? rail(event) : undefined;
          if (id === undefined) return;
          event.stopPropagation();
          onFold(id, event.modifiers.alt);
        }}
        onMouseMove={(event) => { onExtend(); onHover(target(event)); }}
        onMouseOut={() => onHover(undefined)}
      >
        <text width={numbers.length} height={1} fg={theme.muted} selectable={false}>
          {numbers}
        </text>
        <text
          width={1}
          height={1}
          fg={chevronFg}
          selectable={false}
          onMouseDown={(event) => {
            if (fold && !visualLine) event.stopPropagation();
          }}
          onMouseUp={(event) => {
            if (fold && !visualLine && event.button === 0) {
              event.stopPropagation();
              onFold(fold.id, event.modifiers.alt);
            }
          }}
        >
          {visualLine ? " " : chevron(fold)}
        </text>
        <text width={1} height={1} selectable={false}>
          {" "}
        </text>
        <text
          width={available}
          height={1}
          onMouseDown={event => { if (opens !== undefined) event.stopPropagation(); }}
          onMouseUp={event => {
            if (opens !== undefined && event.button === 0) { event.stopPropagation(); onFold(opens, event.modifiers.alt); }
          }}
          content={styled(
            selectedSide === side ? painted.map((s) => ({ ...s, bg })) : painted,
            theme,
            bg,
            focus,
          )}
          selectable={false}
        />

      </box>
    );
  }
  return (
    <box height={1} width="100%" flexDirection="row">
      {row.cell ? (
        cell(
          row.cell,
          measured.cell[visualLine] ?? [],
          geometry.leftWidth + geometry.rightWidth + 1,
          row.cell.newLineNumber === undefined ? "left" : "right",
          true,
        )
      ) : (
        <>
          {cell(
            row.left!,
            measured.left[visualLine] ?? [],
            geometry.leftWidth,
            "left",
          )}
          <text width={1} fg={theme.muted} selectable={false}>
            │
          </text>
          {cell(
            row.right!,
            measured.right[visualLine] ?? [],
            geometry.rightWidth,
            "right",
          )}
        </>
      )}
    </box>
  );
});
