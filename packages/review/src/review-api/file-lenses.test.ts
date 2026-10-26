import { rangeAnchor, sourceAnchors } from "@review/lens-selection.js";
import { type CoverageFile, coverageSources } from "@review/viewed-coverage.js";
import { expect, it } from "vitest";

import {
  fileLensMatcher,
  resolveFileLens,
  uncategorizedSources,
} from "./file-lenses.js";

it("matches file paths, nested test globs, docs and dot directories without scanning other files", () => {
  const patterns = [
    "README.md",
    "**/*.{test,spec}.ts",
    "docs/**",
    ".github/**",
  ];

  for (const path of [
    "README.md",
    "a.test.ts",
    "src/nested/a.spec.ts",
    "docs/guide.md",
    ".github/workflows/check.yml",
  ])
    expect(fileLensMatcher(patterns)({ path })).toBe(true);
  expect(fileLensMatcher(patterns)({ path: "src/main.ts" })).toBe(false);
  expect(fileLensMatcher(["./docs/**"])({ path: "docs/guide.md" })).toBe(true);
});

it("keeps a renamed file in a group matching either side of the rename", () => {
  const file = { path: "guide/intro.md", previousPath: "docs/intro.md" };
  expect(fileLensMatcher(["docs/**"])(file)).toBe(true);
  expect(fileLensMatcher(["guide/**"])(file)).toBe(true);
  expect(fileLensMatcher(["src/**"])(file)).toBe(false);
});

it("keeps partially covered files until both sides are covered, regardless of viewed state", () => {
  const file = {
    path: "new.ts",
    previousPath: "old.ts",
    fingerprint: "same",
    changed: {
      base: [[1, 4] as [number, number]],
      head: [[4, 7] as [number, number]],
    },
    viewed: {
      base: [[1, 4] as [number, number]],
      head: [[4, 7] as [number, number]],
    },
  };

  const head = {
    side: "head" as const,
    file: "new.ts",
    fromLine: 5,
    toLine: 7,
  };

  const base = {
    side: "base" as const,
    file: "old.ts",
    fromLine: 2,
    toLine: 4,
  };

  expect(uncategorizedSources([file], [head])).toEqual([base]);
  expect(uncategorizedSources([file], [head, { ...base, toLine: 3 }])).toEqual([
    { ...base, fromLine: 4 },
  ]);
  expect(uncategorizedSources([file], [head, base])).toEqual([]);
  expect(
    uncategorizedSources([file], [{ ...head, file: "other.ts" }, base]),
  ).toEqual([head]);
});

it("unions mixed targets and canonicalizes renamed files without losing unchanged references", () => {
  const file = {
    path: "new.ts",
    previousPath: "old.ts",
    fingerprint: "f",
    changed: { base: [], head: [] },
    viewed: { base: [], head: [] },
  };

  const base = {
    side: "base" as const,
    file: "old.ts",
    fromLine: 1,
    toLine: 10,
  };

  const head = {
    side: "head" as const,
    file: "new.ts",
    fromLine: 1,
    toLine: 12,
  };

  const context = {
    side: "head" as const,
    file: "context.ts",
    fromLine: 3,
    toLine: 6,
  };

  const result = resolveFileLens(
    {
      id: "lens-1",
      title: "Mixed",
      targets: [
        { kind: "files", patterns: ["old.ts"] },
        {
          kind: "ranges",
          sources: [
            rangeAnchor({ ...head, fromLine: 4, toLine: 8 }),
            rangeAnchor(context),
            rangeAnchor({ ...context, fromLine: 5, toLine: 9 }),
          ],
        },
      ],
    },
    [file],
    new Map([[file.path, [base, head]]]),
    sourceAnchors,
  );

  expect(result.sources).toEqual([base, head, { ...context, toLine: 9 }]);
  expect(result.fileCount).toBe(2);
  expect(result.wholeFiles).toBe(false);
  expect(
    resolveFileLens(
      {
        id: "lens-2",
        title: "Whole files",
        targets: [{ kind: "files", patterns: ["old.ts"] }],
      },
      [file],
      new Map([[file.path, [base, head]]]),
      sourceAnchors,
    ).wholeFiles,
  ).toBe(true);
});

it("resolves overlapping lenses and what they leave uncategorized on a 10,000-file change without stalling the server", () => {
  const hunks: [number, number][] = [
    [0, 5],
    [40, 45],
    [80, 85],
  ];

  const files: CoverageFile[] = Array.from({ length: 10_000 }, (_, i) => ({
    path: `${["src", "docs", "test"][i % 3]}/m${i % 37}/f${i}.ts`,
    fingerprint: `${i}`,
    changed: { base: hunks, head: hunks },
    viewed: { base: [], head: [] },
  }));

  const fileSources = new Map(
    files.map((file) => [file.path, coverageSources(file, file.changed)]),
  );

  const start = performance.now();

  const lenses = [["src/**"], ["docs/**", "test/**"], ["**/m1*/**"]].map(
    (patterns, index) =>
      resolveFileLens(
        {
          id: `${index}`,
          title: `${index}`,
          targets: [{ kind: "files", patterns }],
        },
        files,
        fileSources,
        sourceAnchors,
      ),
  );

  const uncategorized = uncategorizedSources(
    files,
    lenses.slice(0, 2).flatMap((lens) => lens.sources),
  );

  expect(performance.now() - start).toBeLessThan(3_000);
  expect(lenses.map((lens) => lens.fileCount)).toEqual([3334, 6666, 2971]);
  expect(uncategorized).toEqual([]);
});
