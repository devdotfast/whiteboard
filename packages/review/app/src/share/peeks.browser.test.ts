import type { ReviewDiffLayout } from "@dev.fast/review-protocol";
import { afterEach, expect, it, vi } from "vitest";

import { type BoardSources, type PeekSettings, staticPeeks } from "./peeks";

const base = "b".repeat(40);

const head = "a".repeat(40);

const pins = { repositoryId: "repo", base, head };

const sources = [
  {
    kind: "excerpt" as const,
    file: "exec.ts",
    commit: base,
    fromLine: 10,
    lines: ["if (a) {", "  read();", "}"],
  },
  {
    kind: "excerpt" as const,
    file: "exec.ts",
    commit: head,
    fromLine: 12,
    lines: ["if (a) {", "  read();", "  write();", "}"],
  },
];

const spec = {
  path: "exec.ts",
  title: "exec.ts",
  side: "head" as const,
  heightMode: "content" as const,
  ranges: [
    { side: "base" as const, startLine: 10, endLine: 12 },
    { side: "head" as const, startLine: 12, endLine: 15 },
  ],
};

function settings(layout: ReviewDiffLayout, lineNumbers = true) {
  const listeners = new Set<() => void>();

  const peek: PeekSettings = {
    currentDiffLayout: () => layout,
    currentInlineLineNumbers: () => lineNumbers,
    onDidChangeDiffLayout(_scope, listener) {
      const fire = () => listener(layout);
      listeners.add(fire);

      return { dispose: () => listeners.delete(fire) };
    },
    onDidChangeInlineLineNumbers: () => ({ dispose() {} }),
  };

  return {
    peek,
    choose(next: ReviewDiffLayout) {
      layout = next;

      for (const listener of listeners) listener();
    },
  };
}

/** Peeks quoting `code`, drawn as `peek` says. */
async function peeks(peek: PeekSettings, code: BoardSources) {
  const viewer = staticPeeks(peek);
  await viewer.setSources(code);

  return viewer;
}

const container = document.createElement("div");

afterEach(() => container.replaceChildren());

const lines = (selector = "") =>
  [
    ...container.querySelectorAll(
      `${selector} [data-line], ${selector} [data-filler]`,
    ),
  ].map((row) =>
    row.hasAttribute("data-filler")
      ? null
      : [row.getAttribute("data-line"), row.getAttribute("data-change")],
  );

it("shows a selection's base and head ranges as one unified diff", async () => {
  const editors = await peeks(settings("unified").peek, { sources, pins });

  container.innerHTML = editors.renderStatic!(spec);

  expect(lines()).toEqual([
    ["12", null],
    ["13", null],
    ["14", "added"],
    ["15", null],
  ]);
  expect(container.querySelectorAll("[data-range]")).toHaveLength(1);
  expect(container.textContent).not.toContain("Base");
});

it("shows removed lines from the base between the head's", async () => {
  const editors = await peeks(settings("unified").peek, {
    sources: [
      { ...sources[0], lines: ["a", "old", "b"] },
      { ...sources[1], lines: ["a", "new", "b"] },
    ],
    pins,
  });

  container.innerHTML = editors.renderStatic!({
    ...spec,
    ranges: [
      { side: "base", startLine: 10, endLine: 12 },
      { side: "head", startLine: 12, endLine: 14 },
    ],
  });

  expect(
    [...container.querySelectorAll("[data-change]")].map((row) => [
      row.getAttribute("data-line"),
      row.getAttribute("data-change"),
      row.textContent,
    ]),
  ).toEqual([
    ["11", "removed", "11old"],
    ["13", "added", "13new"],
  ]);
});

it("lays a diff out as base and head columns when split", async () => {
  const editors = await peeks(settings("split").peek, {
    sources: [
      { ...sources[0], lines: ["a", "old", "b"] },
      { ...sources[1], lines: ["a", "new", "newer", "b"] },
    ],
    pins,
  });

  container.innerHTML = editors.renderStatic!({
    ...spec,
    ranges: [
      { side: "base", startLine: 10, endLine: 12 },
      { side: "head", startLine: 12, endLine: 15 },
    ],
  });

  expect(lines('[data-column="base"]')).toEqual([
    ["10", null],
    ["11", "removed"],
    null,
    ["12", null],
  ]);
  expect(lines('[data-column="head"]')).toEqual([
    ["12", null],
    ["13", "added"],
    ["14", "added"],
    ["15", null],
  ]);
});

it("hides line numbers unless the reader shows them", async () => {
  const editors = await peeks(settings("unified", false).peek, {
    sources,
    pins,
  });

  container.innerHTML = editors.renderStatic!(spec);

  expect(container.querySelector("[data-line]")?.textContent).toBe("if (a) {");
});

it("follows the reader's layout choice and reports focus", async () => {
  const layout = settings("unified");
  const editors = await peeks(layout.peek, { sources, pins });
  document.body.append(container);
  const onDidFocus = vi.fn<() => void>();

  const handle = editors.create({
    ...spec,
    container,
    active: false,
    onDidFocus,
  });

  layout.choose("split");
  expect(container.querySelectorAll("[data-column]")).toHaveLength(2);

  container.querySelector<HTMLElement>("[tabindex]")!.focus();
  expect(onDidFocus).toHaveBeenCalled();
  handle.dispose();
  container.remove();
});

it("redraws a mounted peek when its sources arrive", async () => {
  const editors = staticPeeks(settings("unified").peek);
  const handle = editors.create({ ...spec, container, active: false });

  expect(container.textContent).toContain("Code unavailable");
  await handle.setFindQuery({
    text: "write",
    matchCase: false,
    wholeWord: false,
    isRegex: false,
  });

  await editors.setSources({ sources, pins });
  expect(lines().map((row) => row?.[0])).toEqual(["12", "13", "14", "15"]);
  expect(container.querySelectorAll("mark[data-match]")).toHaveLength(1);
  handle.dispose();
});

it("reads a pair with differing text as removed then added, and leaves ranges the alignment misses to pairing", async () => {
  const editors = await peeks(settings("unified").peek, {
    sources: [
      { ...sources[0], lines: ["a", "old", "b"] },
      { ...sources[1], lines: ["a", "new", "b", "c"] },
    ],
    pins,
    alignments: [
      {
        file: "exec.ts",
        base,
        head,
        rows: [
          [10, 12],
          [11, 13],
          [12, 14],
        ],
      },
    ],
  });

  container.innerHTML = editors.renderStatic!({
    ...spec,
    ranges: [
      { side: "base", startLine: 10, endLine: 12 },
      { side: "head", startLine: 12, endLine: 14 },
    ],
  });

  expect(lines()).toEqual([
    ["12", null],
    ["11", "removed"],
    ["13", "added"],
    ["14", null],
  ]);
  expect(container.querySelectorAll("[data-range]")).toHaveLength(1);

  container.innerHTML = editors.renderStatic!({
    ...spec,
    ranges: [{ side: "head", startLine: 15, endLine: 15 }],
  });

  expect(lines()).toEqual([["15", null]]);
});
