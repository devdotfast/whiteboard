/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// What the forked review code imported from Review Desktop's generated
// `reviewProtocol.ts`: diffr's wire types and the review contracts it uses.
// Only types come from the contract module, so its zod validators stay out
// of the page.
import type {
  StructuralChanges,
  StructuralLineCounts,
} from "@dev.fast/diffr/src/contract.ts";

export type {
  StructuralPairing,
  StructuralProblem,
  StructuralPos,
  StructuralSpan,
  StructuralVisibility,
  StructuralRegion,
  StructuralSyntaxSpan,
  StructuralSource,
  StructuralLineCounts,
  StructuralStats,
  StructuralDiff,
  StructuralFileRef,
  StructuralFileChange,
  StructuralFileStatus,
  StructuralDiffEvent,
} from "@dev.fast/diffr/src/contract.ts";

export { structuralRows } from "@dev.fast/review-protocol/src/source-alignment.ts";

export function structuralChangeCounts(
  changes: StructuralChanges,
): StructuralLineCounts {
  const count = (ranges: [number, number][]) =>
    ranges.reduce((sum, [start, end]) => sum + end - start, 0);

  return { added: count(changes.head), removed: count(changes.base) };
}

/** One changed file, as the file tree and headers name it. */
export interface ReviewDiffFileWire {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unchanged";
  additions: number;
  deletions: number;
  /** The file's contents are binary. */
  binary?: true;
  patch?: string;
}

export interface ReviewDiffLens {
  wholeFiles?: boolean;
  id: string;
  title: string;
  reviewId: string;
  version: number;
  ranges: readonly {
    side: "base" | "head";
    file: string;
    fromLine: number;
    toLine: number;
  }[];
}

/** "folded": nothing left to read and nothing marked; diffr folds all of it by default. */
export type ReviewDiffProgressState =
  | "unread"
  | "partial"
  | "viewed"
  | "folded";

/** Reader progress is supplied independently of the immutable comparison. */
export interface ReviewDiffProgressFile {
  path: string;
  state: ReviewDiffProgressState;
  remaining: { additions: number; deletions: number };
  total: { additions: number; deletions: number };
  viewedRanges: ReviewDiffLens["ranges"];
  changedRanges: ReviewDiffLens["ranges"];
  unfoldRanges?: ReviewDiffLens["ranges"];
}

export interface ReviewDiffSection {
  files?: readonly ReviewDiffProgressFile[];
  id: string;
  label: string;
  sources: ReviewDiffLens["ranges"];
  state: ReviewDiffProgressState;
  total: { additions: number; deletions: number };
  remaining: { additions: number; deletions: number };
}

export interface ReviewDiffProgress {
  sections?: readonly ReviewDiffSection[];
  files: readonly ReviewDiffProgressFile[];
  /** Only present while applying a new viewed action, to reset affected fold overrides. */
  changedPaths?: readonly string[];
}

/** Marks lines viewed or unviewed; resolves once the new progress is applied. */
export type SetViewed = (
  ranges: ReviewDiffLens["ranges"],
  viewed: boolean,
) => Promise<void>;

/** What the forked view reads from Review Desktop's view spec. */
export interface ReviewDiffViewSpec {
  /** Embed the same diff renderer in the review document. */
  document?: {
    heightMode: "capped" | "content";
    onDidChangeHeight(height: number): void;
    onDidFocus?: () => void;
    onDidOpen?: () => void;
  };
  /** Mark a structural scope using the same persisted line coverage as file marks. */
  onSetViewed?: (
    ranges: ReviewDiffLens["ranges"],
    viewed: boolean,
  ) => void | Promise<void>;
}
