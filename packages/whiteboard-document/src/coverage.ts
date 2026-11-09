import {
  type LineInterval,
  intersectIntervals,
  subtractIntervals,
  unionIntervals,
} from "./intervals.js";
import type { FileLineRange } from "./source.js";

export interface Coverage {
  base: LineInterval[];
  head: LineInterval[];
}

export interface ChangeCounts {
  additions: number;
  deletions: number;
}

/**
 * Changed lines that diffr folds by default count as done, the way the
 * reader's viewed marks do. `folded` is how many of the scope's lines are
 * done only because they are folded; `remaining` excludes them.
 * "folded" is the state of a scope with nothing left to read and nothing the
 * reader marked: all of it starts folded.
 */
export interface CoverageProgress {
  state: "unread" | "partial" | "viewed" | "folded";
  total: ChangeCounts;
  remaining: ChangeCounts;
  folded: ChangeCounts;
}

export interface CoverageFile {
  path: string;
  previousPath?: string;
  fingerprint: string;
  changed: Coverage;
  /** The changed lines diffr folds by default: every changed line of a file
   * it hides, or those under a region that starts collapsed. Absent without
   * structural data, where every changed line is left to read. */
  folded?: Coverage;
  viewed: Coverage;
}

export const emptyCoverage = (): Coverage => ({ base: [], head: [] });

export function changeCounts(coverage: Coverage) {
  const sum = (intervals: readonly LineInterval[]) =>
    intervals.reduce((total, [start, end]) => total + end - start, 0);

  return { added: sum(coverage.head), removed: sum(coverage.base) };
}

export function updateCoverage(
  current: Coverage,
  scope: Coverage,
  viewed: boolean,
): Coverage {
  const apply = (side: "base" | "head") =>
    viewed
      ? unionIntervals([...current[side], ...scope[side]])
      : subtractIntervals(current[side], scope[side]);

  return { base: apply("base"), head: apply("head") };
}

export function scopedCoverage(
  file: CoverageFile,
  sources?: readonly FileLineRange[],
): Coverage {
  if (!sources) return file.changed;

  const side = (side: "base" | "head") =>
    intersectIntervals(
      file.changed[side],
      sources.flatMap((source): LineInterval[] =>
        source.side === side &&
        source.file ===
          (side === "base" ? (file.previousPath ?? file.path) : file.path)
          ? [[source.fromLine - 1, source.toLine]]
          : [],
      ),
    );

  return { base: side("base"), head: side("head") };
}

/** Each file's own sources, grouped once. */
export function sourcesForFile(
  sources?: readonly FileLineRange[],
): (file: CoverageFile) => FileLineRange[] | undefined {
  if (!sources) return () => undefined;
  const byFile = Map.groupBy(sources, (source) => source.file);

  return (file) => {
    const base = byFile.get(file.previousPath ?? file.path) ?? [];

    return file.previousPath && file.previousPath !== file.path
      ? [...base, ...(byFile.get(file.path) ?? [])]
      : base;
  };
}

export function coverageProgress(
  files: readonly CoverageFile[],
  sources?: readonly FileLineRange[],
): CoverageProgress {
  const total = { additions: 0, deletions: 0 },
    remaining = { additions: 0, deletions: 0 },
    folded = { additions: 0, deletions: 0 };

  const own = sourcesForFile(sources);

  for (const file of files) {
    const scope = scopedCoverage(file, own(file));
    const counts = changeCounts(scope);

    const side = (side: "base" | "head") => {
      const unviewed = subtractIntervals(scope[side], file.viewed[side]);

      return {
        unread: subtractIntervals(unviewed, file.folded?.[side] ?? []),
        folded: intersectIntervals(unviewed, file.folded?.[side] ?? []),
      };
    };

    const base = side("base"),
      head = side("head");

    const unread = changeCounts({
      base: base.unread,
      head: head.unread,
    });

    const foldedCounts = changeCounts({
      base: base.folded,
      head: head.folded,
    });

    total.additions += counts.added;
    total.deletions += counts.removed;
    remaining.additions += unread.added;
    remaining.deletions += unread.removed;
    folded.additions += foldedCounts.added;
    folded.deletions += foldedCounts.removed;
  }

  return {
    total,
    remaining,
    folded,
    state: progressState(total, remaining, folded),
  };
}

/** Progress over several comparisons at once: the sums, and the same state
 * rule as one. */
export function mergeCoverageProgress(
  parts: readonly CoverageProgress[],
): CoverageProgress {
  const total = { additions: 0, deletions: 0 },
    remaining = { additions: 0, deletions: 0 },
    folded = { additions: 0, deletions: 0 };

  for (const part of parts) {
    total.additions += part.total.additions;
    total.deletions += part.total.deletions;
    remaining.additions += part.remaining.additions;
    remaining.deletions += part.remaining.deletions;
    folded.additions += part.folded.additions;
    folded.deletions += part.folded.deletions;
  }

  return {
    total,
    remaining,
    folded,
    state: progressState(total, remaining, folded),
  };
}

/** Done lines are the viewed and the folded ones; the state names which. */
function progressState(
  total: ChangeCounts,
  remaining: ChangeCounts,
  folded: ChangeCounts,
): CoverageProgress["state"] {
  const size = total.additions + total.deletions,
    unread = remaining.additions + remaining.deletions,
    viewed = size - unread - folded.additions - folded.deletions;

  if (size > 0 && unread === 0) return viewed > 0 ? "viewed" : "folded";

  return viewed > 0 ? "partial" : "unread";
}

export function coverageSources(
  file: CoverageFile,
  coverage = file.viewed,
): FileLineRange[] {
  return (["base", "head"] as const).flatMap((side) =>
    coverage[side].map(([start, end]) => ({
      side,
      file: side === "base" ? (file.previousPath ?? file.path) : file.path,
      fromLine: start + 1,
      toLine: end,
    })),
  );
}
