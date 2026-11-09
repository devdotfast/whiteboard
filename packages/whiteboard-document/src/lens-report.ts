import type { CoverageFile } from "./coverage.js";
import { type Lens, UNCATEGORIZED_LENS_ID } from "./diff-lenses.js";
import { type ResolvedLens, changedPath } from "./file-lenses.js";
import type { FileLineRange } from "./source.js";

/** The most files an uncategorized report names; the rest are counted. */
const REPORT_FILES = 50;

export interface UncategorizedReport {
  /** Changed lines, counting each side, that no lens selects. */
  lines: number;
  files: {
    path: string;
    lines: number;
    ranges: Pick<FileLineRange, "side" | "fromLine" | "toLine">[];
  }[];
  /** Files past the first REPORT_FILES, left out of `files`. */
  moreFiles?: number;
  /** Changed files with no patch to place. */
  unsupported?: number;
}

/** What a lens author still has to place: the changed lines no lens selects,
 * grouped by file. */
export function uncategorizedReport(
  resolved: readonly ResolvedLens[],
  files: readonly CoverageFile[],
  extra: { unsupported?: number } = {},
): UncategorizedReport {
  const sources =
    resolved.find((lens) => lens.id === UNCATEGORIZED_LENS_ID)?.sources ?? [];

  const byPath = new Map<string, UncategorizedReport["files"][number]>();
  const pathOf = changedPath(files);

  for (const source of sources) {
    const path = pathOf(source);

    const entry = byPath.get(path) ?? { path, lines: 0, ranges: [] };
    entry.lines += source.toLine - source.fromLine + 1;
    entry.ranges.push({
      side: source.side,
      fromLine: source.fromLine,
      toLine: source.toLine,
    });
    byPath.set(path, entry);
  }

  const entries = [...byPath.values()];

  const report: UncategorizedReport = {
    lines: entries.reduce((total, file) => total + file.lines, 0),
    files: entries.slice(0, REPORT_FILES),
  };

  if (entries.length > REPORT_FILES)
    report.moreFiles = entries.length - REPORT_FILES;

  if (extra.unsupported !== undefined) report.unsupported = extra.unsupported;

  return report;
}

/** Each lens as authored, with what it resolves to, for a lens author. */
export function lensReport(
  lenses: readonly Lens[],
  resolved: readonly ResolvedLens[],
  files: readonly CoverageFile[],
  extra: { unsupported?: number } = {},
) {
  return {
    lenses: lenses.map((lens) => {
      const match = resolved.find((item) => item.id === lens.id);

      return {
        ...lens,
        fileCount: match?.fileCount ?? 0,
        ...(match?.unavailable && { unavailable: match.unavailable }),
        ...(match?.unavailableAnchors && {
          unavailableAnchors: match.unavailableAnchors,
        }),
      };
    }),
    uncategorized: uncategorizedReport(resolved, files, extra),
  };
}
