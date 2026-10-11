import type { CoverageProgress } from "@review/viewed-coverage";
import * as stylex from "@stylexjs/stylex";

import { DiffCountHalves } from "./diff-count";

/** The same counts for an HTML caption, outside SVG text. */
export function ElementCountsText({
  progress,
}: {
  progress: CoverageProgress;
}) {
  return progress.state === "viewed" ? (
    <span>✓</span>
  ) : progress.state === "folded" ? (
    <span>Folded</span>
  ) : (
    <span {...stylex.props(styles.counts)}>
      <DiffCountHalves {...progress.remaining} />
    </span>
  );
}

const styles = stylex.create({
  counts: {
    display: "inline-flex",
    gap: "0.3em",
  },
});
