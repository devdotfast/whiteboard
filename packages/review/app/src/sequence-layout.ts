// A sequence diagram's rows, top to bottom. Each row is a message: its label
// above the arrow, the arrow, and for a self-call the loop below it. A row
// starts below everything the row before it drew, so a long label never
// reaches up into a loop or label above it.

/** Where the first arrow sits when its label fits above it. */
const FIRST_ARROW = 112;

/** The bottom of the participant boxes. */
const HEADER_BOTTOM = 56;

/** The least distance between two arrows, so short rows keep their rhythm. */
const MIN_ROW = 76;

/** Space between one row's lowest mark and the next row's label. */
const ROW_GAP = 12;

/** The label's bottom sits this far above its arrow. */
export const SEQUENCE_LABEL_LIFT = 12;

/** A self-call's loop comes back this far below its arrow. */
export const SEQUENCE_SELF_LOOP = 24;

/** The step badge and arrowheads reach this far below a line. */
const MARK = 10;

/** Below the last row. */
const TAIL = 42;

// The label's type: 11px Geist Mono at 14px lines, padded 3px a side.
const LABEL_LINE = 14;

const LABEL_CHAR = 6.6;

const LABEL_PADDING = 6;

export interface SequenceRowInput {
  label: string;
  /** Lane indexes of the message's ends. */
  from: number;
  to: number;
}

export interface SequenceRow {
  /** The arrow's y. */
  arrow: number;
  /** The label's top and bottom. */
  labelTop: number;
  labelBottom: number;
  /** The lowest thing the row draws: arrow, loop or badge. */
  bottom: number;
  /** How wide the label may grow before it wraps. */
  labelWidth: number;
}

/** A label wraps within the lanes its message spans; a self-call has its
 * own lane. */
export function sequenceLabelWidth(
  laneWidth: number,
  from: number,
  to: number,
) {
  return Math.max(1, Math.abs(to - from)) * laneWidth - 12;
}

/** How many lines a label wraps to at this width: at spaces and after
 * hyphens, and anywhere in a word too long for a line. */
export function sequenceLabelLines(label: string, width: number) {
  const perLine = Math.max(1, Math.floor((width - LABEL_PADDING) / LABEL_CHAR));

  const words = label
    .trim()
    .split(/\s+/)
    .flatMap((word) => word.split(/(?<=-)/));

  let lines = 1;
  let used = 0;
  let hyphen = false;

  for (const word of words) {
    if (!word) continue;
    // A word after a space needs the space too; one after a hyphen doesn't.
    const gap = used && !hyphen ? 1 : 0;

    hyphen = word.endsWith("-");

    if (used && used + gap + word.length <= perLine) {
      used += gap + word.length;
      continue;
    }

    if (used) lines++;
    lines += Math.ceil(word.length / perLine) - 1;
    used = word.length % perLine || perLine;
  }

  return lines;
}

export interface SequenceLayout {
  rows: SequenceRow[];
  /** The whole diagram's height, rows and tail. */
  height: number;
}

/** Every row's place, and the height they take together. */
export function sequenceRows(
  messages: readonly SequenceRowInput[],
  laneWidth: number,
): SequenceLayout {
  const rows: SequenceRow[] = [];

  for (const message of messages) {
    const labelWidth = sequenceLabelWidth(laneWidth, message.from, message.to);

    const labelHeight =
      sequenceLabelLines(message.label, labelWidth) * LABEL_LINE;

    const above = rows.at(-1);

    const arrow = Math.max(
      above ? above.arrow + MIN_ROW : FIRST_ARROW,
      (above?.bottom ?? HEADER_BOTTOM) +
        ROW_GAP +
        labelHeight +
        SEQUENCE_LABEL_LIFT,
    );

    const self = message.from === message.to;

    rows.push({
      arrow,
      labelTop: arrow - SEQUENCE_LABEL_LIFT - labelHeight,
      labelBottom: arrow - SEQUENCE_LABEL_LIFT,
      bottom: arrow + (self ? SEQUENCE_SELF_LOOP : 0) + MARK,
      labelWidth,
    });
  }

  return {
    rows,
    height: (rows.at(-1)?.bottom ?? FIRST_ARROW) + TAIL,
  };
}
