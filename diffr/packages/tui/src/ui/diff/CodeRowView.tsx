/** Paint measured Hunk-style code cells; source identity and viewport geometry stay outside React. */
import { memo } from "react";
import { StyledText, parseColor, type MouseEvent } from "@opentui/core";
import type { RenderSpan, SplitLineCell, UnifiedLineCell } from "@diffr/viewer/document/rows";
import type { Geometry, MeasuredRow } from "@diffr/viewer/viewport/geometry";
import { planCell, targetAt, type CellMarks, type PaintRun, type ScopeFocus } from "@diffr/viewer/viewport/cell";
import type { Palette } from "@diffr/viewer/theme/palette";
const colors = new Map<string, ReturnType<typeof parseColor>>();
function color(value: string) {
  let c = colors.get(value);
  if (!c) {
    c = parseColor(value);
    colors.set(value, c);
  }
  return c;
}
const styled = (runs: PaintRun[]) =>
  new StyledText(runs.map((run) => ({ __isChunk: true as const, text: run.text, fg: color(run.fg), bg: color(run.bg) })));
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
  marksOf,
  onMark,
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
  /** The viewed marks on one of the row's cells. */
  marksOf: (value: SplitLineCell | UnifiedLineCell, side: "left" | "right") => CellMarks;
  /** A click on a scope's viewed box. */
  onMark: (id: number) => void;
}) {
  const row = measured.row;
  function cell(
    value: SplitLineCell | UnifiedLineCell,
    spans: RenderSpan[],
    width: number,
    side: "left" | "right",
    unified = false,
  ) {
    const plan = planCell(value, spans, width, unified,
      { theme, geometry, visualLine, focus, selected: selectedSide === side, marks: marksOf(value, side) });
    const column = (event: MouseEvent) => event.x - (event.currentTarget?.x ?? 0);
    const mark = (event: MouseEvent) => targetAt(plan.marks, column(event));
    // Pressing a fold target or a viewed box doesn't start a selection.
    const fold = (event: MouseEvent) => targetAt(plan.hits, column(event));
    return (
      <box
        width={width}
        height={1}
        flexDirection="row"
        backgroundColor={plan.bg}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          if (mark(event) !== undefined || fold(event) !== undefined) event.stopPropagation();
          else onSelect(side);
        }}
        onMouseUp={(event) => {
          const marked = event.button === 0 ? mark(event) : undefined;
          if (marked !== undefined) {
            event.stopPropagation();
            onMark(marked);
            return;
          }
          const id = event.button === 0 ? fold(event) : undefined;
          if (id === undefined) return;
          event.stopPropagation();
          onFold(id, event.modifiers.alt);
        }}
        onMouseMove={(event) => {
          onExtend();
          const boxed = mark(event);
          onHover(boxed !== undefined ? { id: boxed, armed: false, box: true } : targetAt(plan.hovers, column(event)));
        }}
        onMouseOut={() => onHover(undefined)}
      >
        <text width={width} height={1} content={styled(plan.runs)} selectable={false} />
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
