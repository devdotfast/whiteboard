import type { CoverageProgress } from "@review/viewed-coverage";

import { compactDiffCount as compact } from "./diff-count";

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
    <>
      <span className="diff-count-added">
        +{compact(progress.remaining.additions)}
      </span>{" "}
      <span className="diff-count-removed">
        −{compact(progress.remaining.deletions)}
      </span>
    </>
  );
}
