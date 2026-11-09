import { Minimatch } from "minimatch";

import {
  type CoverageFile,
  coverageSources,
  scopedCoverage,
  sourcesForFile,
} from "./coverage.js";
import {
  type DiffLens,
  type Lens,
  UNCATEGORIZED_LENS_ID,
} from "./diff-lenses.js";
import { subtractIntervals, unionIntervals } from "./intervals.js";
import { type LensSource, anchorSelection } from "./lens-selection.js";
import type { FileLineRange } from "./source.js";

export interface FileLensOptions {
  /** Match paths case-insensitively, as on macOS and Windows. */
  nocase?: boolean;
}

export interface ResolvedLens extends DiffLens {
  unavailable?: string;
  /** Range anchors, as authored, that resolved to nothing. */
  unavailableAnchors?: string[];
}

/** Ends with the Uncategorized lens. `resolve` returns undefined for an anchor
 * it cannot resolve. */
export function resolveLenses(
  lenses: readonly Lens[],
  files: readonly CoverageFile[],
  fileSources: ReadonlyMap<string, FileLineRange[]>,
  resolve: (source: LensSource) => FileLineRange[] | undefined,
  options?: FileLensOptions,
): ResolvedLens[] {
  const resolved: ResolvedLens[] = lenses.map((lens) => {
    const { id, title } = lens;
    const unavailableAnchors: string[] = [];

    try {
      const result = resolveFileLens(
        lens,
        files,
        fileSources,
        (source, anchor) => {
          const sources = resolve(source);

          if (!sources) unavailableAnchors.push(anchor);

          return sources ?? [];
        },
        options,
      );

      return {
        id,
        title,
        ...result,
        ...(unavailableAnchors.length && { unavailableAnchors }),
        ...(!result.fileCount && {
          unavailable: "No files match these targets",
        }),
      };
    } catch {
      return {
        id,
        title,
        sources: [],
        unavailable: "Source links need updating at these pins",
      };
    }
  });

  const uncategorized = uncategorizedSources(
    files,
    resolved.flatMap((lens) => (lens.unavailable ? [] : lens.sources)),
  );

  resolved.push({
    id: UNCATEGORIZED_LENS_ID,
    title: "Uncategorized changes",
    sources: uncategorized,
    wholeFiles: false,
    fileCount: new Set(uncategorized.map(changedPath(files))).size,
    ...(!uncategorized.length && {
      unavailable: "All changed lines are covered by lenses",
    }),
  });

  return resolved;
}

/** Subtract authored coverage, independently of viewed state. */
export function uncategorizedSources(
  files: readonly CoverageFile[],
  sources: readonly FileLineRange[],
): FileLineRange[] {
  const own = sourcesForFile(sources);

  return files.flatMap((file) => {
    const covered = scopedCoverage(file, own(file));

    return coverageSources(file, {
      base: subtractIntervals(file.changed.base, covered.base),
      head: subtractIntervals(file.changed.head, covered.head),
    });
  });
}

/** Resolve all targets into one union; a whole-file range subsumes narrower ranges. */
export function resolveFileLens(
  lens: Lens,
  files: readonly CoverageFile[],
  fileSources: ReadonlyMap<string, FileLineRange[]>,
  resolve: (source: LensSource, anchor: string) => FileLineRange[],
  options?: FileLensOptions,
) {
  const targets = lens.targets;

  const selected = targets.flatMap((target) => {
    if (target.kind === "ranges")
      return target.sources.flatMap((source) =>
        resolve(anchorSelection(source), source),
      );
    const matches = fileLensMatcher(target.patterns, options);

    return files
      .filter(matches)
      .flatMap((file) => fileSources.get(file.path) ?? []);
  });

  const groups = new Map<string, FileLineRange[]>();

  for (const source of selected) {
    const key = JSON.stringify([source.side, source.file]);
    const group = groups.get(key) ?? [];
    group.push(source);
    groups.set(key, group);
  }

  const sources = [...groups.values()].flatMap((group) =>
    unionIntervals(
      group.map((source) => [source.fromLine - 1, source.toLine]),
    ).map(([start, end]) => ({
      ...group[0],
      fromLine: start + 1,
      toLine: end,
    })),
  );

  const fileCount = new Set(sources.map(changedPath(files))).size;

  return {
    sources,
    fileCount,
    wholeFiles: targets.every((target) => target.kind === "files"),
  };
}

/** The changed file a source names on its side, or the source's own file. */
export function changedPath(
  files: readonly CoverageFile[],
): (source: FileLineRange) => string {
  const paths = new Map<string, string>();

  for (const file of files)
    for (const key of [
      `base:${file.previousPath ?? file.path}`,
      `head:${file.path}`,
    ])
      if (!paths.has(key)) paths.set(key, file.path);

  return (source) => paths.get(`${source.side}:${source.file}`) ?? source.file;
}

/** Evaluate authored patterns against the changed-file list, never the filesystem. */
export function fileLensMatcher(
  patterns: readonly string[],
  options?: FileLensOptions,
): (file: { path: string; previousPath?: string }) => boolean {
  const matchers = patterns.map((pattern) => {
    const normalized = pattern.startsWith("./") ? pattern.slice(2) : pattern;

    const glob = new Minimatch(normalized, {
      nocase: options?.nocase,
      windowsPathsNoEscape: true,
      nonegate: true,
      nocomment: true,
      optimizationLevel: 2,
      platform: "linux",
      nocaseMagicOnly: true,
      braceExpandMax: 256,
    });

    return (path: string) => path === normalized || glob.match(path);
  });

  return (file) =>
    matchers.some(
      (matches) =>
        matches(file.path) ||
        (file.previousPath !== undefined && matches(file.previousPath)),
    );
}
