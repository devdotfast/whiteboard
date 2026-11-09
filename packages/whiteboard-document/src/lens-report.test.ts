import { expect, it } from "vitest";

import type { CoverageFile } from "./coverage.js";
import { type Lens, UNCATEGORIZED_LENS_ID } from "./diff-lenses.js";
import type { ResolvedLens } from "./file-lenses.js";
import { lensReport, uncategorizedReport } from "./lens-report.js";
import type { FileLineRange } from "./source.js";

const file = (path: string, previousPath?: string): CoverageFile => ({
  path,
  ...(previousPath && { previousPath }),
  fingerprint: path,
  changed: { base: [], head: [] },
  viewed: { base: [], head: [] },
});

const uncategorized = (sources: FileLineRange[]): ResolvedLens => ({
  id: UNCATEGORIZED_LENS_ID,
  title: "Uncategorized",
  sources,
});

it("groups uncategorized lines by changed path, counting each side", () => {
  const report = uncategorizedReport(
    [
      uncategorized([
        { side: "head", file: "a.ts", fromLine: 1, toLine: 3 },
        { side: "base", file: "old.ts", fromLine: 5, toLine: 5 },
        { side: "head", file: "b.ts", fromLine: 2, toLine: 3 },
      ]),
    ],
    [file("a.ts", "old.ts"), file("b.ts")],
  );

  expect(report).toEqual({
    lines: 6,
    files: [
      {
        path: "a.ts",
        lines: 4,
        ranges: [
          { side: "head", fromLine: 1, toLine: 3 },
          { side: "base", fromLine: 5, toLine: 5 },
        ],
      },
      {
        path: "b.ts",
        lines: 2,
        ranges: [{ side: "head", fromLine: 2, toLine: 3 }],
      },
    ],
  });
});

it("lists the first 50 uncategorized files and counts the rest", () => {
  const paths = Array.from({ length: 51 }, (_, i) => `f${i}.ts`);

  const report = uncategorizedReport(
    [
      uncategorized(
        paths.map((path) => ({
          side: "head",
          file: path,
          fromLine: 1,
          toLine: 1,
        })),
      ),
    ],
    paths.map((path) => file(path)),
  );

  expect(report.lines).toBe(51);
  expect(report.files).toHaveLength(50);
  expect(report.moreFiles).toBe(1);
});

it("reports unsupported files only when given, zero included", () => {
  expect(uncategorizedReport([], [])).toEqual({ lines: 0, files: [] });
  expect(uncategorizedReport([], [], { unsupported: 2 })).toEqual({
    lines: 0,
    files: [],
    unsupported: 2,
  });
  expect(uncategorizedReport([], [], { unsupported: 0 }).unsupported).toBe(0);
});

it("reports each authored lens with what it resolved to", () => {
  const lenses: Lens[] = [
    {
      id: "lens-1",
      title: "Docs",
      targets: [{ kind: "files", patterns: ["docs/**"] }],
    },
    {
      id: "lens-2",
      title: "Ranges",
      targets: [{ kind: "files", patterns: ["docs/**"] }],
    },
    {
      id: "lens-3",
      title: "Missing",
      targets: [{ kind: "files", patterns: ["docs/**"] }],
    },
  ];

  const report = lensReport(
    lenses,
    [
      { id: "lens-1", title: "Docs", sources: [], fileCount: 2 },
      {
        id: "lens-2",
        title: "Ranges",
        sources: [],
        fileCount: 0,
        unavailable: "Anchors resolved to nothing.",
        unavailableAnchors: ["a.ts:1-2"],
      },
      uncategorized([{ side: "head", file: "c.ts", fromLine: 1, toLine: 2 }]),
    ],
    [file("c.ts")],
    { unsupported: 3 },
  );

  expect(report).toEqual({
    lenses: [
      { ...lenses[0], fileCount: 2 },
      {
        ...lenses[1],
        fileCount: 0,
        unavailable: "Anchors resolved to nothing.",
        unavailableAnchors: ["a.ts:1-2"],
      },
      { ...lenses[2], fileCount: 0 },
    ],
    uncategorized: {
      lines: 2,
      files: [
        {
          path: "c.ts",
          lines: 2,
          ranges: [{ side: "head", fromLine: 1, toLine: 2 }],
        },
      ],
      unsupported: 3,
    },
  });
});
