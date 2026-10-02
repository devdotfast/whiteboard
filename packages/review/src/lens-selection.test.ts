import { expect, it } from "vitest";
import { z } from "zod";

import {
  anchorSchema,
  anchorSelection,
  formatAnchor,
  parseAnchor,
  resolveDiffSelection,
  selectSource,
  selectionKey,
  selectionProblem,
  sourceAnchors,
} from "./lens-selection.js";
import { textualRows } from "./review-api/lens-alignment.js";
import {
  type CoverageFile,
  coverageProgress,
  emptyCoverage,
  scopedCoverage,
} from "./viewed-coverage.js";

const file = { path: "new.ts", previousPath: "old.ts" };

// A deletion lies between two head lines, followed by an insertion-only row.
const rows = [
  [0, 0],
  [1, null],
  [2, 1],
  [null, 2],
  [3, 3],
  [4, 4],
] as const;

it("includes interior deletion rows when selecting by head endpoints, but excludes surrounding context", () => {
  const scope = resolveDiffSelection(
    {
      file: "new.ts",
      start: { side: "head", line: 1 },
      end: { side: "head", line: 3 },
    },
    rows,
    file,
  );

  expect(scope).toEqual([
    { file: "old.ts", side: "base", fromLine: 1, toLine: 3 },
    { file: "new.ts", side: "head", fromLine: 1, toLine: 3 },
  ]);

  const coverage: CoverageFile = {
    ...file,
    fingerprint: "v1",
    changed: {
      base: [
        [1, 2],
        [4, 5],
      ],
      head: [
        [2, 3],
        [4, 5],
      ],
    },
    viewed: emptyCoverage(),
  };

  expect(coverageProgress([coverage], scope).total).toEqual({
    additions: 1,
    deletions: 1,
  });
  const viewed = scopedCoverage(coverage, scope);
  expect(coverageProgress([{ ...coverage, viewed }], scope).state).toBe(
    "viewed",
  );
  expect(coverageProgress([{ ...coverage, viewed }]).remaining).toEqual({
    additions: 1,
    deletions: 1,
  });
});

it("accepts an interval starting on a deletion and ending on an insertion", () => {
  const selection = anchorSelection("diff/new.ts#L2-R3");

  expect(resolveDiffSelection(selection, rows, file)).toEqual([
    { file: "old.ts", side: "base", fromLine: 2, toLine: 3 },
    { file: "new.ts", side: "head", fromLine: 2, toLine: 3 },
  ]);
});

it("does not widen a one-row selection to adjacent one-sided changes", () => {
  expect(
    resolveDiffSelection(
      {
        file: "new.ts",
        start: { side: "head", line: 2 },
        end: { side: "head", line: 2 },
      },
      rows,
      file,
    ),
  ).toEqual([
    { file: "old.ts", side: "base", fromLine: 3, toLine: 3 },
    { file: "new.ts", side: "head", fromLine: 2, toLine: 2 },
  ]);
});

it("rejects stale or reversed endpoints instead of inventing correspondence", () => {
  for (const selection of [
    {
      file: "new.ts",
      start: { side: "head" as const, line: 99 },
      end: { side: "head" as const, line: 2 },
    },
    {
      file: "new.ts",
      start: { side: "base" as const, line: 4 },
      end: { side: "head" as const, line: 1 },
    },
  ])
    expect(() => resolveDiffSelection(selection, rows, file)).toThrow(
      "endpoints",
    );
});

it("resolves selections over existing textual hunks, including unchanged gaps", () => {
  const alignment = textualRows(
    "a",
    "@@ -2,2 +2,1 @@\n-deleted\n context",
    4,
    3,
  );

  expect(
    resolveDiffSelection(
      {
        file: "a",
        start: { side: "head", line: 1 },
        end: { side: "head", line: 3 },
      },
      alignment,
      { path: "a" },
    ),
  ).toEqual([
    { file: "a", side: "base", fromLine: 1, toLine: 4 },
    { file: "a", side: "head", fromLine: 1, toLine: 3 },
  ]);
});

it("accepts only the anchor string, not any retired object form", () => {
  for (const retired of [
    { file: "a", side: "head", fromLine: 1, toLine: 2 },
    { file: "a", start: { baseLine: 1, headLine: 1 }, end: { baseLine: 2 } },
    {
      file: "a",
      start: { side: "head", line: 1 },
      end: { side: "head", line: 2 },
    },
  ])
    expect(anchorSchema.safeParse(retired).error?.issues[0]?.message).toMatch(
      /Expected a source anchor/,
    );
});

it("takes a diff anchor only across sides", () => {
  for (const oneSide of ["diff/a#L1312-L1323", "diff/a#R7"])
    expect(anchorSchema.safeParse(oneSide).success).toBe(false);
});

it("orders mixed endpoints by alignment position rather than line number", () => {
  expect(
    resolveDiffSelection(
      {
        file: "a",
        start: { side: "base", line: 100 },
        end: { side: "head", line: 2 },
      },
      [
        [99, null],
        [null, 1],
      ],
      { path: "a" },
    ),
  ).toEqual([
    { file: "a", side: "base", fromLine: 100, toLine: 100 },
    { file: "a", side: "head", fromLine: 2, toLine: 2 },
  ]);
});

const pins = { repositoryId: "repo-b", head: "b".repeat(40) };

it("keeps a selection's own pins through its key, its anchors and its round trip from a range", () => {
  const selection = anchorSelection("head/src/a.ts#L2-L4", pins);
  const inherited = anchorSelection("head/src/a.ts#L2-L4");

  expect(selectionKey(selection)).not.toBe(selectionKey(inherited));
  expect(selectionKey(inherited)).toBe(
    JSON.stringify(["src/a.ts", "head", 2, "head", 4]),
  );
  expect(sourceAnchors(selection)).toEqual([
    { file: "src/a.ts", side: "head", fromLine: 2, toLine: 4, pins },
  ]);
  expect(sourceAnchors(inherited)[0]).not.toHaveProperty("pins");
  expect(selectSource(sourceAnchors(selection)[0]!)).toEqual(selection);
  expect(selectSource(sourceAnchors(inherited)[0]!)).toEqual(inherited);
});

it("requires base pins before a selection may touch the base side", () => {
  const anchor = "diff/src/a.ts#L2-R4";

  expect(selectionProblem(anchorSelection(anchor, pins))).toMatch(
    /base-side anchor needs base pins/,
  );
  expect(
    selectionProblem(
      anchorSelection(anchor, { ...pins, base: "a".repeat(40) }),
    ),
  ).toBeUndefined();
});

it("reads the anchor strings agents write", () => {
  expect(parseAnchor("head/src/a b.ts#L10-L24")).toEqual({
    file: "src/a b.ts",
    start: { side: "head", line: 10 },
    end: { side: "head", line: 24 },
  });
  expect(parseAnchor("base/src/a.ts#L7")).toEqual({
    file: "src/a.ts",
    start: { side: "base", line: 7 },
    end: { side: "base", line: 7 },
  });
  expect(parseAnchor("diff/src/a.ts#L84-R90")).toEqual({
    file: "src/a.ts",
    start: { side: "base", line: 84 },
    end: { side: "head", line: 90 },
  });

  for (const text of ["src/a.ts#L1", "head/src/a.ts", "diff/src/a.ts#L1-X2"])
    expect(parseAnchor(text)).toBeUndefined();

  for (const text of [
    "head/src/a b.ts#L10-L24",
    "base/src/a.ts#L7",
    "diff/src/a.ts#L84-R90",
  ])
    expect(formatAnchor(parseAnchor(text)!)).toBe(text);

  expect(() => anchorSchema.parse("head/src/a.ts#L9-L2")).toThrow(
    /ends before it starts/,
  );
});
