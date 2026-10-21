import { expect, it } from "vitest";

import { sharePresentationSchema, sharedSnapshotSchema } from "./import.js";

const element = (path: string, parentPath?: string) => ({
  type: "container" as const,
  id: path,
  path,
  parentPath,
  label: path,
  children: [],
});

const presentation = (elements: ReturnType<typeof element>[]) => ({
  maps: {
    map: {
      commit: "a".repeat(40),
      side: "head" as const,
      elements,
      relationships: [],
      countsByElementPath: {},
      unmappedByElementPath: {},
    },
  },
});

it("reads a map whose elements nest", () => {
  expect(() =>
    sharePresentationSchema.parse(
      presentation([element("app"), element("app.api", "app")]),
    ),
  ).not.toThrow();
});

it.each([
  ["itself", [element("app", "app")]],
  ["a loop", [element("a", "b"), element("b", "c"), element("c", "a")]],
])("refuses map elements nested in %s", (_name, elements) => {
  expect(() => sharePresentationSchema.parse(presentation(elements))).toThrow(
    /nest in a cycle/,
  );
});

const snapshot = (pullRequestUrl: string) => ({
  reviewId: "shared",
  version: 1,
  title: "Board",
  document: [],
  createdAt: "2026-10-20T00:00:00.000Z",
  origin: { pullRequestNumber: 7, pullRequestUrl },
});

it("links a pull request only by its canonical https URL", () => {
  expect(
    sharedSnapshotSchema.parse(snapshot("https://github.com/o/r/pull/7"))
      .origin,
  ).toEqual({
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/o/r/pull/7",
  });

  for (const url of [
    "javascript:alert(1)",
    "http://github.com/o/r/pull/7",
    "/pull/7",
  ])
    expect(() => sharedSnapshotSchema.parse(snapshot(url))).toThrow(
      /pullRequestUrl/,
    );
});
