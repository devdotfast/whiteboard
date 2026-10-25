import { rangeAnchor } from "@review/lens-selection.js";
import { describe, expect, it } from "vitest";

import {
  ReviewInputError,
  boardLinks,
  respellCommitLinks,
  respellLinks,
  sourceReferences,
} from "./document.js";

const sources = (markdown: string) =>
  sourceReferences([{ type: "markdown", id: "n-1", markdown }]);

it("finds actual source links in prose, reference links and tables, not code or unused definitions", () => {
  const references = sources(
    [
      "See [**save**](review-source:head/src/save.ts#L2-L4).",
      "",
      "| Before | Why |",
      "| --- | --- |",
      "| [old][source] | unchanged |",
      "",
      "[source]: review-source:base/src/a%20b.ts#L1",
      "[unused]: review-source:invalid",
      "",
      "`[example](review-source:invalid)`",
      "```md",
      "[example](review-source:invalid)",
      "```",
      "[external](https://example.com/src/save.ts#L2)",
    ].join("\n"),
  );

  expect(references.map((item) => item.source)).toEqual([
    { side: "head", file: "src/save.ts", fromLine: 2, toLine: 4 },
    { side: "base", file: "src/a b.ts", fromLine: 1, toLine: 1 },
  ]);
  expect(
    sources("[new label](review-source:head/src/save.ts#L2-L4)")[0]!.id,
  ).toBe(references[0]!.id);
});

it("rejects malformed source destinations instead of saving a broken peek", () => {
  for (const href of [
    "review-source:main/file.ts#L1",
    "review-source:head/file.ts",
    "review-source:head/file.ts#L0",
    "review-source:head/file.ts#L4-L2",
    "review-source:head/%ZZ.ts#L1",
  ])
    expect(() => sources(`[bad](${href})`)).toThrow(Error);
});

const range = {
  side: "head",
  file: "src/save.ts",
  fromLine: 3,
  toLine: 9,
} as const;

it("marks every source that renders as a peek, but not prose links", () => {
  const references = sourceReferences([
    { type: "code_peek", id: "peek-1", source: rangeAnchor(range) },
    {
      type: "markdown",
      id: "n-2",
      markdown: "[save](review-source:head/src/save.ts#L3-L9)",
    },
    {
      type: "sequence",
      id: "seq-3",
      title: "Save",
      actors: { a: "App", s: "Server" },
      steps: [
        {
          type: "step",
          id: "step-4",
          from: "a",
          to: "s",
          label: "save",
          style: "call",
          source: rangeAnchor(range),
        },
        {
          type: "step",
          id: "step-5",
          from: "s",
          to: "a",
          label: "ok",
          style: "return",
          explanation: "done",
        },
      ],
    },
    {
      type: "call_stack_diff",
      id: "stack-6",
      title: "Save path",
      base: [],
      head: [
        {
          id: "frame-7",
          key: "save",
          label: "save",
          source: rangeAnchor(range),
        },
      ],
    },
    {
      type: "database_lens",
      id: "lens-8",
      title: "Saves",
      actors: { s: "Server" },
      stores: {
        db: {
          label: "DB",
          storage: "relational",
          collections: {
            saves: {
              label: "Saves",
              fields: { id: { label: "id", dataType: "text" } },
            },
          },
        },
      },
      useCases: [
        {
          id: "case-9",
          label: "Save",
          operations: [
            {
              id: "op-10",
              kind: "write",
              store: "db",
              collection: "saves",
              actor: "s",
              label: "insert",
              source: rangeAnchor(range),
            },
          ],
        },
      ],
    },
  ]);

  expect(references.map(({ id, peek }) => [id, peek])).toEqual([
    ["peek-1", true],
    ["n-2:review-source:head/src/save.ts#L3-L9", undefined],
    ["step-4", true],
    ["frame-7", true],
    ["op-10", true],
  ]);
});

it("resolves a block's links at the block's own pins, and only where those pins allow", () => {
  const pins = { repositoryId: "repo-b", head: "b".repeat(40) };

  const [own] = sourceReferences([
    {
      type: "markdown",
      id: "n-2",
      markdown: "[save](review-source:head/src/save.ts#L2-L4)",
      pins,
    },
  ]);

  expect(own!.source).toEqual({
    side: "head",
    file: "src/save.ts",
    fromLine: 2,
    toLine: 4,
    pins,
  });
  expect(() =>
    sourceReferences([
      {
        type: "markdown",
        id: "n-3",
        markdown: "[old](review-source:base/src/save.ts#L2)",
        pins,
      },
    ]),
  ).toThrow(/base-side anchor needs base pins/);
});

for (const href of [
  "packages/review/src/sharing/cli.ts#L76-L80",
  ".github/workflows/review-author.yml",
  "./src/save.ts#L2",
  "../src/save.ts#L2",
  "/src/save.ts#L2",
  "file:///Users/author/repo/src/save.ts#L2",
  "vscode://file/src/save.ts:2",
  "//example.com/src/save.ts",
  "javascript:alert(1)",
]) {
  it(`rejects unsupported Markdown destination ${href}`, () => {
    expect(() => sources(`[file](<${href}>)`)).toThrow(ReviewInputError);
    expect(() => sources(`[file][ref]\n\n[ref]: <${href}>`)).toThrow(
      ReviewInputError,
    );
    expect(
      sourceReferences(
        [{ type: "markdown", id: "old", markdown: `[file](<${href}>)` }],
        { tolerant: true },
      ),
    ).toEqual([]);
  });
}

it("preserves external links, anchors, and literal link examples", () => {
  expect(
    sources(
      "[site](https://example.com/a) [local web](http://localhost/a) [mail](mailto:a@example.com) [section](#details) `[file](src/a.ts)`\n\n```md\n[file](src/a.ts)\n```",
    ),
  ).toEqual([]);
});

it("reads whiteboard:source/ links and retired review-source: links alike", () => {
  expect(
    sources("[save](whiteboard:source/head/src/save.ts#L2-L4)")[0]!.source,
  ).toEqual(sources("[save](review-source:head/src/save.ts#L2-L4)")[0]!.source);
});

it("reads a commit link at that commit of the board's repository", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const markdown = `[old save](whiteboard:source/${sha}/src/save.ts#L3-L9)`;

  expect(
    sourceReferences([{ type: "markdown", id: "n-1", markdown }], {
      repositoryId: "repo",
    }).map((item) => item.source),
  ).toEqual([
    {
      side: "head",
      file: "src/save.ts",
      fromLine: 3,
      toLine: 9,
      pins: { repositoryId: "repo", head: sha },
    },
  ]);
  // A board with no repository has no commit to read.
  expect(() => sources(markdown)).toThrow(Error);
});

it("re-reads a block's links after its text changes in place", () => {
  const block = {
    type: "markdown" as const,
    id: "b1",
    markdown: "[plan](whiteboard:board/11111111-1111-4111-8111-111111111111)",
  };

  expect(boardLinks("x", [block]).map((link) => link.to.board)).toEqual([
    "11111111-1111-4111-8111-111111111111",
  ]);

  block.markdown =
    "[other](whiteboard:board/22222222-2222-4222-8222-222222222222)";

  expect(boardLinks("x", [block]).map((link) => link.to.board)).toEqual([
    "22222222-2222-4222-8222-222222222222",
  ]);
});

describe("link rewriting", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  const markdown = [
    "See [it](review-source:head/src/a.ts#L1) and `[not](review-source:head/src/b.ts#L1)`.",
    "",
    "```md",
    "[nor](review-source:head/src/c.ts#L1)",
    "```",
    "",
    "Read [the trace][ref].",
    "",
    "[ref]: review-trace:t1/e1",
  ].join("\n");

  it("respells retired links in prose and in definitions, never in code", () => {
    expect(respellLinks(markdown)).toBe(
      markdown
        .replace("[it](review-source:", "[it](whiteboard:source/")
        .replace("[ref]: review-trace:", "[ref]: whiteboard:trace/"),
    );
  });

  it("names and respells the commits of commit links in prose, not in code samples", () => {
    const quoted = `\`[x](whiteboard:source/${"e".repeat(12)}/a.ts#L1)\``;

    const document = [
      {
        type: "markdown" as const,
        id: "n-1",
        markdown: `[old](whiteboard:source/${sha}/a.ts#L1) and ${quoted}`,
      },
    ];

    const full = "f".repeat(40);

    expect(
      respellCommitLinks(
        document,
        new Map([
          [sha, full],
          ["e".repeat(12), "d".repeat(40)],
        ]),
      )[0],
    ).toMatchObject({
      markdown: `[old](whiteboard:source/${full}/a.ts#L1) and ${quoted}`,
    });
  });
});
