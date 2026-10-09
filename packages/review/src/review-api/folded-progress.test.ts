import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  STRUCTURAL_DIFF_WIRE_VERSION,
  type StructuralDiff,
  type StructuralDiffEvent,
  type StructuralRegion,
} from "@dev.fast/review-protocol";
import { coverageProgress, coverageSources } from "@review/viewed-coverage.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ReviewApiClient } from "./client.js";
import {
  type ComparisonCoverage,
  comparisonCoverage,
  foldedChanges,
} from "./comparison-coverage.js";
import { UNCATEGORIZED_LENS_ID } from "./diff-lenses.js";
import { createReviewApi } from "./http.js";
import { LocalReviewData } from "./local-data.js";
import type { ReviewProgress } from "./review-progress.js";
import { type ReviewProviders, ReviewStore } from "./store.js";

let nextRoot = 100;

const pins = { repositoryId: "repo", base: "base-commit", head: "head-commit" };

const leaf = (
  id: number,
  alignment: number,
  [from, to]: [number, number],
  changed: number[] = [],
  collapsed = false,
): StructuralRegion => ({
  id,
  fold_state_id: id,
  kind: "leaf",
  alignment_id: alignment,
  start: { line: from, column: 0 },
  end: { line: to, column: 0 },
  changed: changed.map((line) => ({ line, start_column: 0, end_column: 1 })),
  ...(collapsed && { visibility: { collapsed } }),
});

const fold = (
  id: number,
  [from, to]: [number, number],
  collapsed: boolean,
  children: StructuralRegion[],
): StructuralRegion => ({
  id,
  fold_state_id: id,
  kind: "fold",
  indent: { line: from, column: 0 },
  start: { line: from, column: 0 },
  end: { line: to, column: 0 },
  visibility: { collapsed },
  children,
});

const text = (lines: number) =>
  Array.from({ length: lines }, (_, line) => `line ${line}`).join("\n");

/** One changed line in a function, and a test module diffr folds whose three
 * added lines pair with nothing. */
const sourceDiff: Extract<StructuralDiff, { type: "text" }> = {
  type: "text",
  lhs: { text: text(2), root: root([leaf(1, 1, [0, 1], [0])]) },
  rhs: {
    text: text(6),
    root: root([
      leaf(2, 1, [0, 1], [0]),
      fold(3, [2, 5], true, [fold(4, [2, 5], false, [leaf(5, 5, [2, 5])])]),
    ]),
  },
  structural_changes: {
    base: [[0, 1]],
    head: [
      [0, 1],
      [2, 5],
    ],
  },
  stats: {
    textual: { added: 4, removed: 1 },
    visible: { added: 1, removed: 1 },
  },
};

const plainDiff = (lines: number): StructuralDiff => ({
  type: "text",
  lhs: { text: text(lines), root: root([leaf(1, 1, [0, lines], [0])]) },
  rhs: { text: text(lines), root: root([leaf(2, 1, [0, lines], [0])]) },
  structural_changes: { base: [[0, 1]], head: [[0, 1]] },
  stats: {
    textual: { added: 1, removed: 1 },
    visible: { added: 1, removed: 1 },
  },
});

it("folds what diffr folds: hidden regions' changed lines, or a hidden file's", () => {
  expect(foldedChanges(sourceDiff)).toEqual({
    base: [],
    head: [[2, 5]],
  });
  // What stays unfolded is exactly what diffr counts in stats.visible.
  expect(foldedChanges(hideFile(sourceDiff))).toEqual(
    sourceDiff.structural_changes,
  );
  expect(foldedChanges(plainDiff(3))).toEqual({
    base: [],
    head: [],
  });
});

it("a paired leaf folds only its changed lines, and a visible leaf wins a shared line", () => {
  const diff: Extract<StructuralDiff, { type: "text" }> = {
    type: "text",
    lhs: { text: text(4), root: root([leaf(1, 7, [0, 4], [1, 3])]) },
    rhs: {
      text: text(4),
      root: root([
        fold(2, [0, 3], true, [leaf(3, 7, [0, 3], [0, 2])]),
        leaf(4, 8, [2, 4]),
      ]),
    },
    structural_changes: {
      base: [
        [1, 2],
        [3, 4],
      ],
      head: [
        [0, 1],
        [2, 4],
      ],
    },
    stats: {
      textual: { added: 3, removed: 2 },
      visible: { added: 2, removed: 2 },
    },
  };

  expect(foldedChanges(diff)).toEqual({
    base: [],
    head: [[0, 1]],
  });
});

it("any region diffr collapses folds its changed lines, whatever its kind: a docstring counts as done", () => {
  // A function whose docstring diffr starts collapsed; one docstring line and
  // one body line changed. The rule reads the collapsed flag, not the tag.
  const docstring: StructuralRegion = {
    ...fold(2, [1, 4], true, [leaf(3, 3, [1, 4], [2])]),
    tags: ["summarize:docstring"],
  };

  const diff: Extract<StructuralDiff, { type: "text" }> = {
    type: "text",
    lhs: {
      text: text(5),
      root: root([
        leaf(1, 1, [0, 1]),
        leaf(4, 3, [1, 4], [2]),
        leaf(5, 5, [4, 5], [4]),
      ]),
    },
    rhs: {
      text: text(5),
      root: root([leaf(6, 1, [0, 1]), docstring, leaf(7, 5, [4, 5], [4])]),
    },
    structural_changes: {
      base: [
        [2, 3],
        [4, 5],
      ],
      head: [
        [2, 3],
        [4, 5],
      ],
    },
    stats: {
      textual: { added: 2, removed: 2 },
      visible: { added: 1, removed: 2 },
    },
  };

  const folded = foldedChanges(diff);
  expect(folded).toEqual({ base: [], head: [[2, 3]] });
  expect(
    coverageProgress([
      {
        path: "doc.py",
        fingerprint: "f",
        changed: diff.structural_changes,
        folded,
        viewed: {
          base: [
            [2, 3],
            [4, 5],
          ],
          head: [[4, 5]],
        },
      },
    ]),
  ).toMatchObject({
    state: "viewed",
    remaining: { additions: 0, deletions: 0 },
    folded: { additions: 1, deletions: 0 },
  });
});

let directory: string, store: ReviewStore;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "review-folded-"));
  vi.stubEnv("DEV_REVIEW_HOME", directory);

  const providers: ReviewProviders = {
    validatePins: vi.fn<ReviewProviders["validatePins"]>(async () => {}),
    validateSource: vi.fn<ReviewProviders["validateSource"]>(async () => {}),
    validateResource: vi.fn<ReviewProviders["validateResource"]>(
      async () => {},
    ),
  };

  store = new ReviewStore(path.join(directory, "reviews.db"), providers);
});

afterEach(async () => {
  await store.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const ref = (path: string) => ({
  lhs: { path, oid: "base", mode: "100644" },
  rhs: { path, oid: "head", mode: "100644" },
});

const records: {
  path: string;
  diff: StructuralDiff;
}[] = [
  { path: "src/api.rs", diff: sourceDiff },
  { path: "src/main.rs", diff: plainDiff(2) },
  {
    path: "Cargo.lock",
    diff: hideFile(plainDiff(2)),
  },
  { path: "docs/readme.md", diff: plainDiff(2) },
];

async function progressApi(beforeFiles?: () => Promise<void>) {
  const run = <Operation>(operation: Operation) => store.execute({ operation });

  const { reviewId } = await run({
    type: "create",
    title: "Folds",
    target: { kind: "commits", ...pins },
  });

  await run({
    type: "lens_edit",
    reviewId,
    edit: {
      type: "insert",
      title: "Rust",
      targets: [{ kind: "files", patterns: ["src/**", "Cargo.lock"] }],
    },
  });

  const data = new LocalReviewData(store);
  vi.spyOn(data, "resolveSource").mockImplementation(async (snapshot) => ({
    snapshot,
    pins: snapshot.pins!,
  }));
  vi.spyOn(data, "changes").mockImplementation((async (
    _pins: typeof pins,
    file?: string,
  ) =>
    file
      ? file === "src/api.rs"
        ? "@@ -1 +1 @@\n-old\n+new\n@@ -2,0 +3,3 @@\n+test1\n+test2\n+test3\n"
        : "@@ -1 +1 @@\n-old\n+new\n"
      : records.map(({ path }) => ({
          path,
          status: "modified",
          additions: path === "src/api.rs" ? 4 : 1,
          deletions: 1,
        }))) as typeof data.changes);
  vi.spyOn(data, "file").mockImplementation(async (at, side, file) => ({
    file,
    side,
    commit: at[side],
    text: text(file === "src/api.rs" && side === "head" ? 6 : 2),
  }));
  vi.spyOn(data, "structuralChanges").mockImplementation(async function* () {
    yield {
      type: "start",
      version: STRUCTURAL_DIFF_WIRE_VERSION,
      lhs: { type: "revision", rev: "base" },
      rhs: { type: "revision", rev: "head" },
      files: records.map(({ path }) => ({
        file: ref(path),
        status: "modified" as const,
      })),
    } satisfies StructuralDiffEvent;

    await beforeFiles?.();

    for (const { path, diff } of records)
      yield { type: "file", file: ref(path), diff };
    yield { type: "complete", succeeded: records.length, failed: 0 };
  });

  const app = createReviewApi(store, data);

  const client = new ReviewApiClient(
    { serverUrl: "http://review", token: "token" },
    async (url, init) =>
      app.request(String(url).replace("http://review/reviews-api", ""), init),
  );

  return { reviewId, client, data };
}

it("progress counts folded changes as done, overall, per lens and uncategorized", async () => {
  const { reviewId, client } = await progressApi();
  const progress = await client.read<ReviewProgress>(`/${reviewId}/progress`);

  const lens = (id: string) =>
    progress.lenses.find((lens) => lens.id === id)!.sources;

  // 4+1 in api.rs (3 folded), 1+1 in each other file, the lockfile folded.
  expect(coverageProgress(progress.files)).toEqual({
    state: "unread",
    total: { additions: 7, deletions: 4 },
    remaining: { additions: 3, deletions: 3 },
    folded: { additions: 4, deletions: 1 },
  });
  expect(coverageProgress(progress.files, lens("lens-1"))).toMatchObject({
    remaining: { additions: 2, deletions: 2 },
    folded: { additions: 4, deletions: 1 },
  });
  expect(
    coverageProgress(progress.files, lens(UNCATEGORIZED_LENS_ID)),
  ).toMatchObject({
    remaining: { additions: 1, deletions: 1 },
    folded: { additions: 0, deletions: 0 },
  });

  const file = (path: string) =>
    progress.files.find((file) => file.path === path)!;

  expect(coverageProgress([file("Cargo.lock")]).state).toBe("folded");

  // Viewing every unfolded line reads 100%, with the folded code unopened.
  const viewed = await client.post<ReviewProgress>(`/${reviewId}/progress`, {
    mode: "structural",
    version: store.read(reviewId).version,
    viewed: true,
    files: ["src/api.rs", "src/main.rs", "docs/readme.md"].map((path) => ({
      path,
      fingerprint: file(path).fingerprint,
      sources: coverageSources(file(path), file(path).changed).filter(
        (source) => !(path === "src/api.rs" && source.fromLine > 1),
      ),
    })),
  });

  const after = coverageProgress(viewed.files);
  expect(after.remaining).toEqual({ additions: 0, deletions: 0 });
  expect(after.state).toBe("viewed");
  expect(
    coverageProgress(
      viewed.files,
      viewed.lenses.find((lens) => lens.id === "lens-1")!.sources,
    ).state,
  ).toBe("viewed");
});

it("counts all changes before plugins finish and preserves viewed marks as folds arrive", async () => {
  let release!: () => void;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const { reviewId, client, data } = await progressApi(() => gate);

  try {
    const initial = await vi.waitFor(async () => {
      const progress = await client.read<ReviewProgress>(
        `/${reviewId}/progress?wait=false`,
      );

      expect(progress.complete).toBe(true);

      return progress;
    });

    expect(initial.lenses.every((lens) => !lens.pending)).toBe(true);
    expect(coverageProgress(initial.files).remaining).toEqual({
      additions: 7,
      deletions: 4,
    });

    const uncategorized = initial.lenses.find(
      (lens) => lens.id === UNCATEGORIZED_LENS_ID,
    )!;

    expect(
      coverageProgress(initial.files, uncategorized.sources).remaining,
    ).toEqual({ additions: 1, deletions: 1 });

    const file = initial.files.find((file) => file.path === "docs/readme.md")!;

    const marked = await client.post<ReviewProgress>(`/${reviewId}/progress`, {
      mode: "structural",
      version: store.read(reviewId).version,
      viewed: true,
      files: [
        {
          path: file.path,
          fingerprint: file.fingerprint,
          sources: uncategorized.sources,
        },
      ],
    });

    expect(coverageProgress(marked.files, uncategorized.sources).state).toBe(
      "viewed",
    );
    release();
    await data.coverage(reviewId, pins, "structural");
    const final = await client.read<ReviewProgress>(`/${reviewId}/progress`);
    expect(coverageProgress(final.files).total).toEqual({
      additions: 7,
      deletions: 4,
    });
    expect(coverageProgress(final.files).remaining).toEqual({
      additions: 2,
      deletions: 2,
    });
    expect(coverageProgress(final.files, uncategorized.sources).state).toBe(
      "viewed",
    );
  } finally {
    release();
    data.close();
  }
});

it("keeps Git's rename identity and counts when diffr emits separate deletion and addition records", async () => {
  const data = new LocalReviewData(store);
  vi.spyOn(data, "changes").mockImplementation((async (
    _pins: typeof pins,
    file?: string,
  ) => {
    if (!file)
      return [
        {
          path: "new.ts",
          previousPath: "old.ts",
          status: "renamed",
          additions: 1,
          deletions: 1,
        },
      ];

    return "@@ -2 +2 @@\n-old\n+new\n";
  }) as typeof data.changes);
  vi.spyOn(data, "file").mockImplementation(async (at, side, file) => ({
    file,
    side,
    commit: at[side],
    text: `context\n${side}\ncontext`,
  }));
  const deleted = { lhs: { path: "old.ts", oid: "base", mode: "100644" } };
  const added = { rhs: { path: "new.ts", oid: "head", mode: "100644" } };
  vi.spyOn(data, "structuralChanges").mockImplementation(async function* () {
    yield {
      type: "start",
      version: STRUCTURAL_DIFF_WIRE_VERSION,
      lhs: { type: "revision", rev: pins.base },
      rhs: { type: "revision", rev: pins.head },
      files: [
        { file: deleted, status: "deleted" },
        { file: added, status: "added" },
      ],
    };
    yield {
      type: "file",
      file: deleted,
      diff: {
        type: "text",
        lhs: {
          text: "context\nbase\ncontext",
          root: root([leaf(1, 1, [0, 3])]),
        },
        structural_changes: { base: [[0, 3]], head: [] },
        stats: {
          textual: { added: 0, removed: 3 },
          visible: { added: 0, removed: 3 },
        },
      },
    };
    yield {
      type: "file",
      file: added,
      diff: hideFile({
        type: "text",
        rhs: {
          text: "context\nhead\ncontext",
          root: root([leaf(2, 2, [0, 3])]),
        },
        structural_changes: { base: [], head: [[0, 3]] },
        stats: {
          textual: { added: 3, removed: 0 },
          visible: { added: 0, removed: 0 },
        },
      }),
    };
  });
  const snapshots: ComparisonCoverage[] = [];

  const final = await comparisonCoverage(
    data,
    "review",
    pins,
    "structural",
    new AbortController().signal,
    (snapshot) => snapshots.push(snapshot),
  );

  expect(final.files).toHaveLength(1);
  expect(final.files[0]).toMatchObject({
    path: "new.ts",
    previousPath: "old.ts",
  });
  expect(coverageProgress(final.files).total).toEqual({
    additions: 1,
    deletions: 1,
  });
  expect(coverageProgress(final.files).remaining).toEqual({
    additions: 0,
    deletions: 1,
  });
  expect(coverageProgress(snapshots[0].files).remaining).toEqual({
    additions: 1,
    deletions: 1,
  });
  data.close();
});

function root(children: StructuralRegion[]): StructuralRegion {
  const id = nextRoot++;

  return {
    kind: "fold",
    id,
    fold_state_id: id,
    start: children[0].start,
    end: children.at(-1)!.end,
    indent: children[0].start,
    children,
  };
}

function hideFile(diff: StructuralDiff): StructuralDiff {
  const hidden = structuredClone(diff);

  if (hidden.type === "text")
    for (const source of [hidden.lhs, hidden.rhs])
      if (source)
        source.root.visibility = { collapsed: true, label: "Test file" };

  return hidden;
}
