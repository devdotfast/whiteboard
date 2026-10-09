import { createHash } from "node:crypto";

import {
  type StructuralDiff,
  type StructuralRegion,
  type StructuralSource,
  structuralRows,
} from "@dev.fast/review-protocol";
import type { AlignmentRow } from "@review/lens-selection.js";
import type { FileLineRange } from "@review/source.js";
import { parseUnifiedPatch } from "@review/unified-diff.js";
import {
  type Coverage,
  type CoverageFile,
  type LineInterval,
  emptyCoverage,
  intersectIntervals,
  subtractIntervals,
  unionIntervals,
} from "@review/viewed-coverage.js";

import type { Pins } from "./document.js";
import { textualRows } from "./lens-alignment.js";
import type { LocalReviewData } from "./local-data.js";

export type CoverageMode = "structural" | "textual";

const hash = (parts: (string | null)[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export interface ComparisonCoverage {
  /** All Git changes are counted, even if folding is still loading. */
  counted: boolean;
  files: CoverageFile[];
  fileSources: Map<string, FileLineRange[]>;
  alignments: Map<string, readonly AlignmentRow[]>;
}

/** Immutable comparison facts shared by catalog totals and review progress. */
export async function comparisonCoverage(
  data: LocalReviewData,
  reviewId: string,
  pins: Pins,
  mode: CoverageMode,
  signal: AbortSignal,
  publish?: (coverage: ComparisonCoverage) => void,
): Promise<ComparisonCoverage> {
  const fileSources = new Map<string, FileLineRange[]>();
  const alignments = new Map<string, readonly AlignmentRow[]>();

  const files: CoverageFile[] = [];

  for (const file of await data.changes(pins)) {
    signal.throwIfAborted();
    const patch = await data.changes(pins, file.path, file.previousPath);
    const changed = emptyCoverage();

    for (const hunk of parseUnifiedPatch(file.path, patch))
      for (const line of hunk.lines) {
        if (line.kind === "add")
          changed.head.push([line.newLine! - 1, line.newLine!]);

        if (line.kind === "remove")
          changed.base.push([line.oldLine! - 1, line.oldLine!]);
      }

    changed.base = unionIntervals(changed.base);
    changed.head = unionIntervals(changed.head);

    const [base, head] = await Promise.all([
      file.status === "added"
        ? null
        : data
            .file(pins, "base", file.previousPath ?? file.path)
            .then((value) => value.text)
            .catch(() => null),
      file.status === "deleted"
        ? null
        : data
            .file(pins, "head", file.path)
            .then((value) => value.text)
            .catch(() => null),
    ]);

    alignments.set(
      file.path,
      textualRows(
        file.path,
        patch,
        base === null ? 0 : base.split("\n").length,
        head === null ? 0 : head.split("\n").length,
      ),
    );

    const readable =
      (file.status === "added" || base !== null) &&
      (file.status === "deleted" || head !== null);

    const fingerprint = hash([
      pins.repositoryId,
      base,
      head,
      ...(readable ? [] : [pins.base, pins.head, patch]),
    ]);

    fileSources.set(file.path, [
      ...(base !== null
        ? [
            {
              side: "base" as const,
              file: file.previousPath ?? file.path,
              fromLine: 1,
              toLine: base.split("\n").length,
            },
          ]
        : []),
      ...(head !== null
        ? [
            {
              side: "head" as const,
              file: file.path,
              fromLine: 1,
              toLine: head.split("\n").length,
            },
          ]
        : []),
    ]);
    files.push({
      path: file.path,
      previousPath: file.previousPath,
      fingerprint,
      changed,
      viewed: emptyCoverage(),
    });

    if (mode === "textual")
      publish?.({
        counted: false,
        files: [...files],
        fileSources: new Map(fileSources),
        alignments: new Map(alignments),
      });
  }

  const coverage: ComparisonCoverage = {
    files,
    fileSources,
    alignments,
    counted: true,
  };

  if (mode === "textual") return coverage;

  // Keep Git's totals and file identities while structural results add folding.
  const publishCurrent = () =>
    publish?.({ ...coverage, files: [...coverage.files] });

  publishCurrent();

  const baseFiles = new Map(
    coverage.files.map((file, index) => [
      file.previousPath ?? file.path,
      index,
    ]),
  );

  const headFiles = new Map(
    coverage.files.map((file, index) => [file.path, index]),
  );

  const remaining = new Set<string>();

  for await (const event of data.structuralChanges({
    reviewId,
    pins,
    signal,
  })) {
    if (event.type === "start") {
      for (const entry of event.files)
        remaining.add((entry.file.rhs ?? entry.file.lhs)!.path);

      if (!remaining.size) break;
      continue;
    }

    if (event.type === "complete" && (event.failed || event.aborted))
      throw new Error(
        event.aborted?.message ?? "Structural coverage is incomplete.",
      );

    if (event.type !== "file") continue;

    const path = (event.file.rhs ?? event.file.lhs)!.path;

    if (!remaining.delete(path))
      throw new Error(`Unexpected structural result: ${path}`);

    if (event.error) {
      if (
        event.error.code !== "unsupported_file_type" &&
        event.error.code !== "not_utf8"
      )
        throw new Error(`Cannot count ${path}: ${event.error.message}`);
    } else if (event.diff.type === "text") {
      const diff = event.diff;
      const folded = foldedChanges(diff);

      // Match each side separately: diffr can split a Git rename into two files.
      for (const side of ["base", "head"] as const) {
        const source = side === "base" ? event.file.lhs : event.file.rhs;

        const index =
          source && (side === "base" ? baseFiles : headFiles).get(source.path);

        if (index === undefined) continue;
        const file = coverage.files[index];

        const visible = subtractIntervals(
          diff.structural_changes[side],
          folded[side],
        );

        coverage.files[index] = {
          ...file,
          folded: {
            ...(file.folded ?? emptyCoverage()),
            [side]: subtractIntervals(file.changed[side], visible),
          },
        };
      }

      const baseIndex = event.file.lhs && baseFiles.get(event.file.lhs.path);
      const headIndex = event.file.rhs && headFiles.get(event.file.rhs.path);
      const index = headIndex ?? baseIndex;

      if (index !== undefined) {
        const sources =
          coverage.fileSources.get(coverage.files[index].path) ?? [];

        if (
          sources.every(
            (source) =>
              source.file ===
              (source.side === "base" ? event.file.lhs : event.file.rhs)?.path,
          )
        )
          coverage.alignments = new Map(coverage.alignments).set(
            coverage.files[index].path,
            structuralRows(diff),
          );
      }

      publishCurrent();
    }

    if (!remaining.size) break;
  }

  if (remaining.size) throw new Error("Structural coverage is incomplete.");

  return coverage;
}

/**
 * The changed lines diffr folds by default. A file it hides (lockfiles,
 * generated, vendored and test files, per its plugins) folds all of them.
 * Otherwise they are the changed lines under regions that start collapsed
 * and in no visible leaf: `structural_changes` less what diffr counts in
 * `stats.visible`, recomputed the way diffr's `change_coverage` does so that
 * the lines, not just the counts, are known. A paired leaf contributes its
 * changed spans' lines; an unpaired leaf, all of its lines.
 */
export function foldedChanges(diff: StructuralDiff): Coverage {
  if (diff.type !== "text") return emptyCoverage();
  const all = diff.structural_changes;

  const side = (
    changed: readonly LineInterval[],
    source: StructuralSource | undefined,
    other: StructuralSource | undefined,
  ): LineInterval[] => {
    if (source?.root.visibility?.collapsed) return unionIntervals(changed);

    const paired = new Set<number>();

    const pair = (region: StructuralRegion) => {
      if (region.kind === "leaf") paired.add(region.alignment_id);
      else region.children.forEach(pair);
    };

    if (other) pair(other.root);

    const hidden: LineInterval[] = [],
      visible: LineInterval[] = [];

    const collect = (region: StructuralRegion, folded: boolean) => {
      folded ||= region.visibility?.collapsed === true;

      if (region.kind === "fold") {
        for (const child of region.children) collect(child, folded);

        return;
      }

      const lines = folded ? hidden : visible;

      if (paired.has(region.alignment_id))
        for (const span of region.changed ?? [])
          lines.push([span.line, span.line + 1]);
      else
        lines.push([
          region.start.line,
          region.end.column === 0 ? region.end.line : region.end.line + 1,
        ]);
    };

    if (source) collect(source.root, false);

    return subtractIntervals(intersectIntervals(changed, hidden), visible);
  };

  return {
    base: side(all.base, diff.lhs, diff.rhs),
    head: side(all.head, diff.rhs, diff.lhs),
  };
}
