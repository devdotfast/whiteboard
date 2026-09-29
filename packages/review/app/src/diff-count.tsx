import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { tokens } from "./tokens.stylex";

export const compactDiffCount = (count: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
    .format(count)
    .toLowerCase();

/**
 * The one way a +n −n pair is written anywhere in the app: the add and
 * delete tokens, tabular mono at 11px, compact past 999. Cards, meta lines,
 * commit rows, lens rows and the progress line all render this.
 */
export function DiffCount({
  additions,
  deletions,
  large = false,
}: {
  additions: number;
  deletions: number;
  /** The review header's size. */
  large?: boolean;
}): ReactElement {
  return (
    <span {...stylex.props(diffCountStyles.counts, large && styles.large)}>
      <span {...stylex.props(diffCountStyles.added)}>
        +{compactDiffCount(additions)}
      </span>
      <span {...stylex.props(diffCountStyles.removed)}>
        −{compactDiffCount(deletions)}
      </span>
    </span>
  );
}

export const diffCountStyles = stylex.create({
  counts: {
    display: "inline-flex",
    gap: "6px",
    font: `11px ${tokens.fontMono}`,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    fontSize: "11px",
  },
  added: {
    color: tokens.changeAdded,
  },
  removed: {
    color: tokens.changeRemoved,
  },
});

const styles = stylex.create({
  large: {
    fontSize: "13px",
    gap: "10px",
  },
});
