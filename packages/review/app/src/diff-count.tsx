import { fontSize } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { tokens } from "./tokens.stylex";

export const compactDiffCount = (count: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
    .format(count)
    .toLowerCase();

/** The +n and −n halves, each left out at zero. */
export function DiffCountHalves({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): ReactElement {
  return (
    <>
      {additions > 0 && (
        <span {...stylex.props(diffCountStyles.added)}>
          +{compactDiffCount(additions)}
        </span>
      )}
      {deletions > 0 && (
        <span {...stylex.props(diffCountStyles.removed)}>
          −{compactDiffCount(deletions)}
        </span>
      )}
    </>
  );
}

/**
 * The one way a +n −n pair is written anywhere in the app: the add and
 * delete tokens, tabular mono at 11px, compact past 999. Cards, meta lines,
 * commit rows, lens rows and the progress line all render this.
 */
export function DiffCount({
  additions,
  deletions,
  binary = false,
  large = false,
}: {
  additions: number;
  deletions: number;
  binary?: boolean;
  /** The review header's size. */
  large?: boolean;
}): ReactElement {
  return (
    <span {...stylex.props(diffCountStyles.counts, large && styles.large)}>
      {binary ? (
        "Binary"
      ) : (
        <DiffCountHalves additions={additions} deletions={deletions} />
      )}
    </span>
  );
}

export const diffCountStyles = stylex.create({
  counts: {
    display: "inline-flex",
    gap: "6px",
    font: `${fontSize.small} ${tokens.fontMono}`,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    fontSize: fontSize.small,
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
    fontSize: fontSize.ui,
    gap: "10px",
  },
});
