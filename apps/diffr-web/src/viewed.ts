/**
 * What the reader marked viewed, as line ranges per file, kept in this browser for each pull
 * request or comparison. A file's marks are dropped once its contents change, the way GitHub
 * clears a file's viewed box after a push. Review Desktop gets this progress from its host; here
 * it is worked out from diffr's changed lines.
 */
import { Emitter } from "vs/base/common/event.js";
import { Disposable } from "vs/base/common/lifecycle.js";

import type {
  ReviewDiffLens,
  ReviewDiffProgress,
  ReviewDiffProgressFile,
  StructuralDiff,
} from "./protocol.js";
import { readSetting, writeSetting } from "./settings.js";

type Ranges = ReviewDiffLens["ranges"];

type Range = Ranges[number];

interface StoredFile {
  /** What the file was when it was marked: its blob ids. */
  version: string;
  ranges: Range[];
}

interface Known {
  /** The file's base-side name. */
  base: string;
  version: string;
  changed: Range[];
}

export class ViewedProgress extends Disposable {
  private readonly changed = this._register(new Emitter<void>());
  readonly onDidChange = this.changed.event;
  private readonly stored: Record<string, StoredFile>;
  private readonly known = new Map<string, Known>();
  private current: ReviewDiffProgress = { files: [] };

  constructor(private readonly key: string) {
    super();
    let stored: Record<string, StoredFile> = {};

    try {
      stored = JSON.parse(readSetting(`viewed.${key}`) ?? "{}");
    } catch {
      // Unreadable: start over.
    }

    this.stored = stored;
  }

  get progress(): ReviewDiffProgress {
    return this.current;
  }

  /** A file is diffed: its changed lines, and the version its marks belong to. */
  addFile(
    path: string,
    previousPath: string | undefined,
    version: string,
    diff: StructuralDiff,
  ): void {
    const changed: Range[] = [];

    if (diff.type === "text") {
      for (const [start, end] of diff.structural_changes.base)
        changed.push({
          side: "base",
          file: previousPath ?? path,
          fromLine: start + 1,
          toLine: end,
        });

      for (const [start, end] of diff.structural_changes.head)
        changed.push({
          side: "head",
          file: path,
          fromLine: start + 1,
          toLine: end,
        });
    }

    this.known.set(path, { base: previousPath ?? path, version, changed });
    const stored = this.stored[path];

    if (stored && stored.version !== version) {
      delete this.stored[path];
      this.save();
    }

    this.update();
  }

  async setViewed(
    ranges: Ranges,
    viewed: boolean,
    paths?: readonly string[],
  ): Promise<void> {
    const touched = new Set<string>(paths);

    for (const [path, known] of this.known) {
      const mine = ranges.filter(
        (range) => range.file === known.base || range.file === path,
      );

      if (!mine.length) continue;
      touched.add(path);
      const current = this.stored[path]?.ranges ?? [];

      const next = viewed
        ? merge([...current, ...mine])
        : subtract(current, mine);

      if (next.length)
        this.stored[path] = { version: known.version, ranges: next };
      else delete this.stored[path];
    }

    this.save();
    this.update([...touched]);
  }

  /** The file's header box: all of its changes viewed, or none. */
  toggleFile(path: string): Promise<void> {
    const file = this.current.files.find((file) => file.path === path);
    const known = this.known.get(path);

    if (!known) return Promise.resolve();

    return this.setViewed(known.changed, file?.state !== "viewed", [path]);
  }

  private save(): void {
    writeSetting(
      `viewed.${this.key}`,
      Object.keys(this.stored).length ? JSON.stringify(this.stored) : undefined,
    );
  }

  private update(changedPaths?: readonly string[]): void {
    const files: ReviewDiffProgressFile[] = [];

    for (const [path, known] of this.known) {
      const viewedRanges = this.stored[path]?.ranges ?? [];
      const viewed = intersect(known.changed, viewedRanges);

      const count = (ranges: Ranges, side: Range["side"]) =>
        ranges.reduce(
          (sum, r) => sum + (r.side === side ? r.toLine - r.fromLine + 1 : 0),
          0,
        );

      const total = {
        additions: count(known.changed, "head"),
        deletions: count(known.changed, "base"),
      };

      const remaining = {
        additions: total.additions - count(viewed, "head"),
        deletions: total.deletions - count(viewed, "base"),
      };

      const size = total.additions + total.deletions;
      const unread = remaining.additions + remaining.deletions;
      files.push({
        path,
        state:
          size > 0 && unread === 0
            ? "viewed"
            : unread < size
              ? "partial"
              : "unread",
        total,
        remaining,
        viewedRanges,
        changedRanges: known.changed,
      });
    }

    this.current = { files, changedPaths };
    this.changed.fire();

    if (changedPaths) this.current = { files };
  }
}

const same = (a: Range, b: Range) => a.side === b.side && a.file === b.file;

function merge(ranges: readonly Range[]): Range[] {
  const result: Range[] = [];

  for (const range of [...ranges].sort(
    (a, b) =>
      a.side.localeCompare(b.side) ||
      a.file.localeCompare(b.file) ||
      a.fromLine - b.fromLine,
  )) {
    const last = result[result.length - 1];

    if (last && same(last, range) && range.fromLine <= last.toLine + 1)
      result[result.length - 1] = {
        ...last,
        toLine: Math.max(last.toLine, range.toLine),
      };
    else result.push(range);
  }

  return result;
}

function intersect(a: readonly Range[], b: readonly Range[]): Range[] {
  return merge(
    a.flatMap((left) =>
      b.flatMap((right) => {
        if (!same(left, right)) return [];
        const fromLine = Math.max(left.fromLine, right.fromLine);
        const toLine = Math.min(left.toLine, right.toLine);

        return fromLine <= toLine ? [{ ...left, fromLine, toLine }] : [];
      }),
    ),
  );
}

function subtract(
  ranges: readonly Range[],
  removed: readonly Range[],
): Range[] {
  let result = merge(ranges);

  for (const cut of removed) {
    result = result.flatMap((range) => {
      if (
        !same(range, cut) ||
        cut.toLine < range.fromLine ||
        cut.fromLine > range.toLine
      )
        return [range];
      const pieces: Range[] = [];

      if (cut.fromLine > range.fromLine)
        pieces.push({ ...range, toLine: cut.fromLine - 1 });

      if (cut.toLine < range.toLine)
        pieces.push({ ...range, fromLine: cut.toLine + 1 });

      return pieces;
    });
  }

  return result;
}
