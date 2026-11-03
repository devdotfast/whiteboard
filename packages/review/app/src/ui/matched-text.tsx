import { tokens } from "@canvas/tokens.stylex";
import { fuzzySegments } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

/** `text` with the letters the queries hit marked; `from`/`to` show a
 * slice of it. A query that misses the text marks nothing. */
export function MatchedText({
  text,
  queries,
  from = 0,
  to = text.length,
}: {
  text: string;
  queries: readonly string[];
  from?: number;
  to?: number;
}): ReactNode {
  const matched = new Set<number>();

  for (const query of queries) {
    let offset = 0;

    for (const segment of fuzzySegments(query, text)) {
      if (segment.matched)
        for (let i = offset; i < offset + segment.text.length; i++)
          matched.add(i);
      offset += segment.text.length;
    }
  }

  const segments: ReactNode[] = [];

  for (let start = from; start < to; ) {
    let end = start + 1;

    while (end < to && matched.has(end) === matched.has(start)) end++;
    const part = text.slice(start, end);

    segments.push(
      matched.has(start) ? (
        <mark key={start} {...stylex.props(styles.mark)}>
          {part}
        </mark>
      ) : (
        part
      ),
    );
    start = end;
  }

  return segments;
}

const styles = stylex.create({
  mark: { color: tokens.ink, backgroundColor: tokens.markerTint },
});
