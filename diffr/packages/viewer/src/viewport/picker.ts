/** Plans the Ctrl-P picker's lines; each frontend draws them over the bottom of the diff. */
import type { LineCounts } from "../document/counts";
import type { Pick } from "../document/pick";
import { measureTextWidth, sliceTextByWidth } from "../terminal/text";
import { sanitizeTerminalLine } from "../terminal/sanitize";
import type { Palette } from "../theme/palette";
import type { PaintRun } from "./cell";

export interface PickerRun extends PaintRun {
  bold?: boolean;
}

export interface PickerLine {
  /** Exactly the picker's width. */
  runs: PickerRun[];
  /** The file a click on this line goes to. */
  pick?: number;
}

export interface PickerState {
  query: string;
  cursor: number;
  picks: Pick[];
  total: number;
}

/** Runs padded or cut to exactly `width` cells. */
function exactly(runs: PickerRun[], width: number, bg: string): PickerRun[] {
  const result: PickerRun[] = [];
  let room = width;
  for (const run of runs) {
    if (room <= 0) break;
    const cells = measureTextWidth(run.text);
    result.push(cells <= room ? run : { ...run, text: sliceTextByWidth(run.text, 0, room).text });
    room -= Math.min(cells, room);
  }
  if (room > 0) result.push({ text: " ".repeat(room), fg: bg, bg });
  return result;
}

/**
 * The picker, `height` lines at most: a count, the results around the cursor, and the prompt.
 * A path too long for its line loses its start, so the file name always shows; matched letters
 * take the accent, and a viewed file reads faint with a ✓ where its counts would be.
 */
export function pickerLines(state: PickerState, width: number, height: number, theme: Palette,
  counts: (index: number) => LineCounts | undefined, viewed: (index: number) => boolean, closeHint: string): PickerLine[] {
  const bg = theme.chrome;
  const room = Math.max(1, Math.min(state.picks.length, height - 2));
  const first = Math.max(0, Math.min(state.cursor - room + 1, state.picks.length - room));
  const count = `${state.picks.length} of ${state.total} changed files `;
  const lines: PickerLine[] = [{ runs: exactly([{ text: " ".repeat(Math.max(0, width - measureTextWidth(count))), fg: bg, bg },
    { text: count, fg: theme.muted, bg }], width, bg) }];
  for (const [offset, pick] of state.picks.slice(first, first + room).entries()) {
    const cursor = first + offset === state.cursor, rowBg = cursor ? theme.highlight : bg;
    const read = viewed(pick.fileIndex), tally = counts(pick.fileIndex);
    const right: PickerRun[] = read ? [{ text: "✓ ", fg: theme.accent, bg: rowBg }]
      : tally ? [{ text: `+${tally.added} `, fg: theme.addedText, bg: rowBg }, { text: `−${tally.removed} `, fg: theme.removedText, bg: rowBg }]
        : [{ text: " ", fg: rowBg, bg: rowBg }];
    const rightWidth = right.reduce((n, run) => n + measureTextWidth(run.text), 0);
    const room = Math.max(1, width - 2 - rightWidth - 1);
    let path = sanitizeTerminalLine(pick.path), shift = 0;
    if (measureTextWidth(path) > room) {
      shift = path.length - (room - 1);
      path = `…${path.slice(shift)}`;
      shift -= 1;
    }
    const matched = new Set(pick.indexes.map((index) => index - shift));
    const nameStart = path.lastIndexOf("/") + 1;
    const runs: PickerRun[] = [{ text: cursor ? "▸ " : "  ", fg: theme.accent, bg: rowBg }];
    [...path].forEach((char, index) => {
      const fg = matched.has(index) ? theme.accent : read ? theme.muted : index < nameStart ? theme.fileHeaderDir : theme.fg;
      const bold = matched.has(index) && !read;
      const last = runs.at(-1)!;
      if (last.fg === fg && !!last.bold === bold && runs.length > 1) last.text += char;
      else runs.push({ text: char, fg, bg: rowBg, bold });
    });
    const used = runs.reduce((n, run) => n + measureTextWidth(run.text), 0);
    runs.push({ text: " ".repeat(Math.max(0, width - used - rightWidth)), fg: rowBg, bg: rowBg }, ...right);
    lines.push({ runs: exactly(runs, width, rowBg), pick: pick.fileIndex });
  }
  const hint = `⏎ open · ↑↓ or ctrl-n/p move · ${closeHint} `;
  const typed: PickerRun[] = [{ text: "› ", fg: theme.accent, bg }, { text: state.query, fg: theme.fg, bg },
    { text: " ", fg: theme.bg, bg: theme.fg }];
  const typedWidth = typed.reduce((n, run) => n + measureTextWidth(run.text), 0);
  lines.push({ runs: exactly([...typed, { text: " ".repeat(Math.max(1, width - typedWidth - measureTextWidth(hint))), fg: bg, bg },
    { text: hint, fg: theme.muted, bg }], width, bg) });
  return lines;
}
