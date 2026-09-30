import {
  ASK_ANCHOR_TEXT_LIMIT,
  type AgentSelection,
} from "@review/agent-selection";

import { reviewTextIndex } from "./review-find-text";

/** Where an Ask selection is: characters of one review block's text. */
export type AskAnchor = NonNullable<
  Extract<AgentSelection["target"], { kind: "text" }>["anchor"]
>;

const BLOCK = "[data-review-node-id]";

/** Past this many edits between a block's two texts, the edits are taken
 * as one change spanning them all. */
const EDIT_LIMIT = 2_000;

/** The innermost review block holding all of a selection, and where the
 * selection is in that block's text. None outside a block, or in a block
 * too long to keep. */
export function askAnchor(range: Range): AskAnchor | undefined {
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;

  let block = start?.closest(BLOCK) ?? null;

  while (block && !block.contains(range.endContainer))
    block = block.parentElement?.closest(BLOCK) ?? null;

  if (!(block instanceof HTMLElement)) return undefined;
  const blockId = block.dataset.reviewNodeId;
  const index = reviewTextIndex(block);
  const from = index.offset(range.startContainer, range.startOffset);
  const to = index.offset(range.endContainer, range.endOffset);

  if (
    !blockId ||
    from === null ||
    to === null ||
    from >= to ||
    index.text.length > ASK_ANCHOR_TEXT_LIMIT
  )
    return undefined;

  return { blockId, start: from, end: to, text: index.text };
}

/** The anchored words in the review as rendered now, with where they are
 * in their block's text; null when the block is gone or an edit touched
 * them. */
export function resolveAskAnchor(
  article: HTMLElement,
  anchor: AskAnchor,
): { range: Range; start: number; end: number } | null {
  const block = [...article.querySelectorAll<HTMLElement>(BLOCK)].find(
    (element) => element.dataset.reviewNodeId === anchor.blockId,
  );

  if (!block) return null;
  const index = reviewTextIndex(block);
  const span = mapSpan(anchor.text, index.text, anchor.start, anchor.end);
  const range = span && index.range(span.start, span.end);

  return span && range && { range, ...span };
}

/** A stretch of `before` that became a stretch of `after`; an insertion
 * is empty in `before`, a deletion in `after`. */
interface TextChange {
  beforeStart: number;
  beforeEnd: number;
  afterStart: number;
  afterEnd: number;
}

/** Where `start`–`end` of `before` is in `after`: shifted by what was added
 * or removed ahead of it, or null when an edit touched it. Insertions at
 * its edges leave it whole. */
export function mapSpan(
  before: string,
  after: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  if (before === after) return { start, end };
  let shift = 0;

  for (const change of textChanges(before, after)) {
    const inserted = change.beforeStart === change.beforeEnd;

    const touched = inserted
      ? change.beforeStart > start && change.beforeStart < end
      : change.beforeStart < end && change.beforeEnd > start;

    if (touched) return null;

    const ahead = inserted
      ? change.beforeStart <= start
      : change.beforeEnd <= start;

    if (ahead)
      shift +=
        change.afterEnd -
        change.afterStart -
        (change.beforeEnd - change.beforeStart);
  }

  return { start: start + shift, end: end + shift };
}

/** The changes from `before` to `after`, in order: the shortest edit script
 * (Myers' diff) between what their common start and end leave. */
function textChanges(before: string, after: string): TextChange[] {
  let head = 0;

  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  )
    head += 1;

  let tail = 0;

  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;

  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);

  if (!a && !b) return [];

  const changes = myers(a, b) ?? [
    { beforeStart: 0, beforeEnd: a.length, afterStart: 0, afterEnd: b.length },
  ];

  return changes.map((change) => ({
    beforeStart: change.beforeStart + head,
    beforeEnd: change.beforeEnd + head,
    afterStart: change.afterStart + head,
    afterEnd: change.afterEnd + head,
  }));
}

/** Myers' O(ND) diff, as the changes between runs of equal text; null past
 * `EDIT_LIMIT` edits. */
function myers(a: string, b: string): TextChange[] | null {
  const n = a.length;
  const m = b.length;
  // trace[d][k + d]: the furthest x reached on diagonal k with d edits.
  const trace: Int32Array[] = [];
  const at = (d: number, k: number) => trace[d]![k + d]!;
  let found = -1;

  for (let d = 0; d <= Math.min(n + m, EDIT_LIMIT) && found < 0; d += 1) {
    const v = new Int32Array(2 * d + 1);

    for (let k = -d; k <= d; k += 2) {
      let x =
        d === 0
          ? 0
          : k === -d || (k !== d && at(d - 1, k - 1) < at(d - 1, k + 1))
            ? at(d - 1, k + 1)
            : at(d - 1, k - 1) + 1;

      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }

      v[k + d] = x;

      if (x >= n && y >= m) found = d;
    }

    trace.push(v);
  }

  if (found < 0) return null;

  // Walk back from the end, one edit at a time, marking each edited
  // character; runs of them are the changes.
  const deleted = new Uint8Array(n);
  const inserted = new Uint8Array(m);
  let x = n;
  let y = m;

  for (let d = found; d > 0; d -= 1) {
    const k = x - y;

    const down = k === -d || (k !== d && at(d - 1, k - 1) < at(d - 1, k + 1));

    const previousK = down ? k + 1 : k - 1;
    const previousX = at(d - 1, previousK);
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
    }

    if (down) inserted[previousY] = 1;
    else deleted[previousX] = 1;
    x = previousX;
    y = previousY;
  }

  const changes: TextChange[] = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && !deleted[i] && !inserted[j]) {
      i += 1;
      j += 1;
      continue;
    }

    const change = { beforeStart: i, beforeEnd: i, afterStart: j, afterEnd: j };

    while (i < n && deleted[i]) i += 1;

    while (j < m && inserted[j]) j += 1;

    // Unreachable for a complete edit script; stops a malformed one.
    if (i === change.beforeStart && j === change.afterStart) return null;
    change.beforeEnd = i;
    change.afterEnd = j;
    changes.push(change);
  }

  return changes;
}
