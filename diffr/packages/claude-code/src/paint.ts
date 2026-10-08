import type { RenderSpan, SplitLineCell, UnifiedLineCell } from "@diffr/viewer/document/rows";
import { planCell, type CellOptions, type Target } from "@diffr/viewer/viewport/cell";
import { measureTextWidth, sliceTextByWidth } from "@diffr/viewer/terminal/text";
import type { Hover } from "@diffr/viewer/viewer";
import type { Action, Line, Segment } from "./protocol";

export const fit = (text: string, width: number) => sliceTextByWidth(text, 0, width).text;

export class Colors {
  readonly list: string[] = [];
  private readonly index = new Map<string, number>();
  of(color: string) {
    let at = this.index.get(color);
    if (at === undefined) {
      at = this.list.push(color) - 1;
      this.index.set(color, at);
    }
    return at;
  }
}

/** Adjacent runs in one style merge; `width` is in terminal cells. */
export class LineBuilder {
  private readonly segments: Segment[] = [];
  private readonly hits: Target<Action>[] = [];
  private readonly hovers: Target<Hover>[] = [];
  width = 0;
  constructor(private readonly colors: Colors, private readonly bg: string) {}
  text(text: string, fg: string, bg = this.bg, bold = false) {
    if (!text) return this;
    const segment: Segment = [text, this.colors.of(fg), this.colors.of(bg)];
    if (bold) segment.push(1);
    const last = this.segments.at(-1);
    if (last && last[1] === segment[1] && last[2] === segment[2] && last[3] === segment[3]) last[0] += text;
    else this.segments.push(segment);
    this.width += measureTextWidth(text);
    return this;
  }
  fill(to: number, bg = this.bg) {
    return to > this.width ? this.text(" ".repeat(to - this.width), bg, bg) : this;
  }
  hit(from: number, to: number, act: Action) {
    if (to > from) this.hits.push([from, to, act]);
    return this;
  }
  hover(from: number, to: number, hover: Hover) {
    if (to > from) this.hovers.push([from, to, hover]);
    return this;
  }
  cut(width: number) {
    let room = width;
    const segments: Segment[] = [];
    for (const segment of this.segments) {
      if (room <= 0) break;
      const cells = measureTextWidth(segment[0]);
      segments.push(cells <= room ? segment : [fit(segment[0], room), ...segment.slice(1)] as Segment);
      room -= cells;
    }
    this.segments.splice(0, this.segments.length, ...segments);
    this.width = Math.min(this.width, width);
    return this;
  }
  line(width: number): Line {
    this.fill(width).cut(width);
    const line: Line = { bg: this.colors.of(this.bg), segments: this.segments };
    if (this.hits.length) line.hits = this.hits;
    if (this.hovers.length) line.hovers = this.hovers;
    return line;
  }
}

export function paintCell(
  line: LineBuilder,
  value: SplitLineCell | UnifiedLineCell,
  spans: RenderSpan[],
  width: number,
  unified: boolean,
  { fileIndex, ...options }: CellOptions & { fileIndex: number },
) {
  const start = line.width;
  const plan = planCell(value, spans, width, unified, options);
  for (const run of plan.runs) line.text(run.text, run.fg, run.bg);
  // Hits are matched first to last, so the viewed box goes ahead of the fold row it sits on.
  for (const [from, to, id] of plan.marks) line.hit(start + from, start + to, { viewed: id, file: fileIndex });
  for (const [from, to, id] of plan.hits) line.hit(start + from, start + to, { fold: id, file: fileIndex });
  // Hovers are matched first to last too: on the box, the pointer is on the box, not the code under it.
  for (const [from, to, id] of plan.marks) line.hover(start + from, start + to, { file: fileIndex, id, armed: false, box: true });
  for (const [from, to, focus] of plan.hovers) line.hover(start + from, start + to, { file: fileIndex, ...focus });
}
