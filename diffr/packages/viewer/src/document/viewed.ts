/** Which changed lines the reader has marked viewed, for the viewer's lifetime only. */
import type { LineCounts } from "./counts";
import { changedLines, defaultCollapsed, flatten, hiddenLines, type Side, type SideLines } from "./regions";
import type { TextDiff } from "../protocol/wire";

/** `viewed` once nothing is left to read, `partial` once some of it is. */
export interface Progress {
  remaining: LineCounts;
  state: "unread" | "partial" | "viewed";
}

/**
 * The lines there are to read: the changed lines diffr shows by default. Lines it starts folded
 * away, and every line of a file it hides, are already accounted for, as diffr's `stats.visible`
 * counts them.
 */
function linesToRead(diff: TextDiff): SideLines {
  if ((diff.rhs ?? diff.lhs)!.root.visibility.collapsed) return [new Set(), new Set()];
  const { leaves, folds } = flatten(diff);
  const changed = changedLines(leaves), collapsed = defaultCollapsed(diff);
  return ([0, 1] as const).map((side) => {
    const hidden = hiddenLines(folds[side], collapsed);
    return new Set([...changed[side]].filter((line) => !hidden.has(line)));
  }) as unknown as SideLines;
}

export class ViewedLines {
  /** Viewed lines per manifest file, base then head. */
  private readonly read = new Map<number, readonly [Set<number>, Set<number>]>();
  private readonly toRead = new WeakMap<TextDiff, SideLines>();

  private linesOf(diff: TextDiff): SideLines {
    let lines = this.toRead.get(diff);
    if (!lines) {
      lines = linesToRead(diff);
      this.toRead.set(diff, lines);
    }
    return lines;
  }

  /** The file's lines to read, or only those inside `within`; undefined when there are none. */
  progress(index: number, diff: TextDiff, within?: SideLines): Progress | undefined {
    const read = this.read.get(index);
    const count = (side: Side) => {
      let total = 0, left = 0;
      for (const line of this.linesOf(diff)[side]) {
        if (within && !within[side].has(line)) continue;
        total++;
        if (!read?.[side].has(line)) left++;
      }
      return [total, left] as const;
    };
    const [removed, removedLeft] = count(0), [added, addedLeft] = count(1);
    if (!added && !removed) return undefined;
    const left = addedLeft + removedLeft;
    return { remaining: { added: addedLeft, removed: removedLeft },
      state: !left ? "viewed" : left === added + removed ? "unread" : "partial" };
  }

  isRead(index: number, side: Side, line: number): boolean {
    return this.read.get(index)?.[side].has(line) ?? false;
  }

  /** Marks or unmarks the file's lines to read, or only those inside `within`. */
  mark(index: number, diff: TextDiff, viewed: boolean, within?: SideLines) {
    let read = this.read.get(index);
    if (!read) {
      read = [new Set(), new Set()];
      this.read.set(index, read);
    }
    for (const side of [0, 1] as const)
      for (const line of this.linesOf(diff)[side]) {
        if (within && !within[side].has(line)) continue;
        if (viewed) read[side].add(line);
        else read[side].delete(line);
      }
  }
}
