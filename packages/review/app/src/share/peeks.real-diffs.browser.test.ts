import type {
  ReviewDiffLayout,
  ReviewPeekStaticSpec,
} from "@dev.fast/review-protocol";
import type {
  ShareAlignment,
  ShareSource,
} from "@dev.fast/review-share-protocol";
import { textualRows } from "@review/review-api/lens-alignment";
import { type DiffHunk, parseUnifiedPatch } from "@review/unified-diff";
import { afterEach, describe, expect, it } from "vitest";

import fixtures from "./__fixtures__/real-diffs.json";
import { type PeekSettings, sharePeeks } from "./peeks";

interface Fixture {
  name: string;
  base: string;
  head: string;
  file: string;
  previousFile?: string;
  baseText: string | null;
  headText: string | null;
  patch: string;
}

type Rendered = (string | null)[] | null;

const settings = (
  layout: ReviewDiffLayout,
  lineNumbers = true,
): PeekSettings => ({
  currentDiffLayout: () => layout,
  currentInlineLineNumbers: () => lineNumbers,
  onDidChangeDiffLayout: () => ({ dispose() {} }),
  onDidChangeInlineLineNumbers: () => ({ dispose() {} }),
});

const container = document.createElement("div");

afterEach(() => container.replaceChildren());

const lines = (selector = ""): Rendered[] =>
  [
    ...container.querySelectorAll(
      `${selector} [data-line], ${selector} [data-filler]`,
    ),
  ].map((row) =>
    row.hasAttribute("data-filler")
      ? null
      : [row.getAttribute("data-line"), row.getAttribute("data-change")],
  );

const texts = () =>
  [...container.querySelectorAll("[data-line]")].map((row) => row.textContent);

const lineCount = (text: string | null) =>
  text === null ? 0 : text.split("\n").length;

function share(fixture: Fixture) {
  const pins = { repositoryId: "repo", base: fixture.base, head: fixture.head };

  const rows = textualRows(
    fixture.file,
    fixture.patch,
    lineCount(fixture.baseText),
    lineCount(fixture.headText),
  );

  const sources: ShareSource[] = [];

  if (fixture.baseText !== null)
    sources.push({
      kind: "excerpt",
      file: fixture.previousFile ?? fixture.file,
      commit: fixture.base,
      fromLine: 1,
      lines: fixture.baseText.split("\n"),
    });

  if (fixture.headText !== null)
    sources.push({
      kind: "excerpt",
      file: fixture.file,
      commit: fixture.head,
      fromLine: 1,
      lines: fixture.headText.split("\n"),
    });

  const alignment: ShareAlignment = {
    file: fixture.file,
    ...(fixture.previousFile && { previousFile: fixture.previousFile }),
    head: fixture.head,
    base: fixture.base,
    rows: rows.map(([base, head]) => [
      base === null ? null : base + 1,
      head === null ? null : head + 1,
    ]),
  };

  return {
    pins,
    sources,
    alignment,
    hunks: parseUnifiedPatch(fixture.file, fixture.patch),
  };
}

function hunkSpec(file: string, hunk: DiffHunk): ReviewPeekStaticSpec {
  return {
    path: file,
    title: file,
    side: "head",
    heightMode: "content",
    ranges: [
      ...(hunk.oldLines
        ? [
            {
              side: "base" as const,
              startLine: hunk.oldStart,
              endLine: hunk.oldStart + hunk.oldLines - 1,
            },
          ]
        : []),
      ...(hunk.newLines
        ? [
            {
              side: "head" as const,
              startLine: hunk.newStart,
              endLine: hunk.newStart + hunk.newLines - 1,
            },
          ]
        : []),
    ],
  };
}

/** The hunk as Git prints it. */
const unified = (hunk: DiffHunk): Rendered[] =>
  hunk.lines.map((line) =>
    line.kind === "context"
      ? [String(line.newLine), null]
      : line.kind === "remove"
        ? [String(line.oldLine), "removed"]
        : [String(line.newLine), "added"],
  );

function split(hunk: DiffHunk) {
  const columns: Record<"base" | "head", Rendered[]> = { base: [], head: [] };
  let removed: Rendered[] = [];
  let added: Rendered[] = [];

  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      columns.base.push(removed[i] ?? null);
      columns.head.push(added[i] ?? null);
    }

    [removed, added] = [[], []];
  };

  for (const line of hunk.lines)
    if (line.kind === "remove") removed.push([String(line.oldLine), "removed"]);
    else if (line.kind === "add") added.push([String(line.newLine), "added"]);
    else {
      flush();
      columns.base.push([String(line.oldLine), null]);
      columns.head.push([String(line.newLine), null]);
    }

  flush();

  return columns;
}

describe.each(fixtures as Fixture[])("$name", (fixture) => {
  const { pins, sources, alignment, hunks } = share(fixture);

  it("shows each hunk as Git does, in both layouts, with its text", async () => {
    const editors = await sharePeeks(sources, pins, [alignment]);

    for (const hunk of hunks) {
      const spec = hunkSpec(fixture.file, hunk);

      container.innerHTML = editors(settings("unified")).renderStatic!(spec);
      expect(lines()).toEqual(unified(hunk));
      expect(container.querySelectorAll("[data-range]")).toHaveLength(1);

      container.innerHTML = editors(settings("unified", false)).renderStatic!(
        spec,
      );
      expect(texts()).toEqual(hunk.lines.map((line) => line.text));

      container.innerHTML = editors(settings("split")).renderStatic!(spec);
      const columns = split(hunk);
      expect(lines('[data-column="base"]')).toEqual(columns.base);
      expect(lines('[data-column="head"]')).toEqual(columns.head);
    }
  });

  it("shows what a selection on one side's changed lines alone replaced", async () => {
    const editors = await sharePeeks(sources, pins, [alignment]);

    for (const hunk of hunks) {
      // The hunk's first change: its lines up to the next context line.
      const start = hunk.lines.findIndex((line) => line.kind !== "context");
      let end = start;

      while (hunk.lines[end + 1] && hunk.lines[end + 1]!.kind !== "context")
        end++;

      const change = hunk.lines.slice(start, end + 1);
      const removed = change.filter((line) => line.kind === "remove");
      const added = change.filter((line) => line.kind === "add");
      // The patch pairs its i-th removed line with its i-th added line.
      const pairs = Math.min(removed.length, added.length);

      const row = (line: DiffHunk["lines"][number]): Rendered =>
        line.kind === "remove"
          ? [String(line.oldLine), "removed"]
          : [String(line.newLine), "added"];

      for (const [side, own, expected] of [
        [
          "head",
          added,
          [...removed.slice(0, pairs).map(row), ...added.map(row)],
        ],
        [
          "base",
          removed,
          [...removed.map(row), ...added.slice(0, pairs).map(row)],
        ],
      ] as const) {
        if (!own.length) continue;
        const at = side === "head" ? "newLine" : "oldLine";

        container.innerHTML = editors(settings("unified")).renderStatic!({
          ...hunkSpec(fixture.file, hunk),
          ranges: [
            { side, startLine: own[0]![at]!, endLine: own.at(-1)![at]! },
          ],
        });

        expect(lines()).toEqual(expected);
      }
    }
  });
});
